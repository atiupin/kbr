; Town/Castle Gate destination picker -- replaces the gate's two-character letter list
; with a named list in its own window, drawn the way the spell book draws.
;
; The point is the naming, not the layout. In English the listed letter IS the town's
; first letter, so nothing is looked up; no Cyrillic scheme reproduces that, because the
; letter a Russian player presses for "А" depends on whether they think in translit (A)
; or in keyboard position (F), and those two disagree on every letter of the alphabet.
; Printing the name beside the key removes the question: the letter becomes a menu key
; with no relation to the spelling, exactly as the spell book's own A-G column already is.
;
; The letter stays bound to the destination, not to the position in the list: castle 1 is
; always B, so an unvisited one leaves a gap. Numbering the visited ones consecutively
; instead would silently send a player who knows B is Basefit to whatever took the slot,
; and would throw away what the gap tells them -- that there is a B castle still to find.
;
; far, cdecl:  picker(word flag)     flag 0 = castles, nonzero = towns
; returns AL = slot index 0..25 for the caller's existing coordinate lookup, 0xFF to cancel.
;
; Assembled into DGROUP above the string pool, so labels are DS offsets and CS == DS at run
; time. Every callf needs an MZ relocation entry.

; ---- engine entry points ------------------------------------------------------------
VID         equ 0x1168          ; window and text library
ADV         equ 0x0207          ; adventure-screen helpers
CRT         equ 0x0000          ; Turbo C runtime

WIN_NEW     equ 0x03ca          ; (x1,y1,x2,y2) cells -> struct, 0 if all 3 slots are busy
WIN_OPEN    equ 0x088b          ; (win)  saves what is under it and makes it current
WIN_CLOSE   equ 0x08ee          ; (win)  restores it
WIN_PAGE    equ 0x0cb8          ; (page)
WIN_ATTACH  equ 0x0f00          ; (n)    binds the window to draw surface n
WIN_JUST    equ 0x0f97          ; (mode) 2 = centre; cleared by hand afterwards
GOTOXY      equ 0x0fb7          ; (col, y)  col in 8px cells, y in PIXELS -- not symmetric
PUTS        equ 0x1063
PUTCH       equ 0x05eb
FRAME       equ 0x01a5          ; ADV (x1,y1,x2,y2) cells, same rect as WIN_NEW
GETKEY      equ 0x006c          ; ADV (lo, hi) -> key, or 0x1b for ESC
RESTORE     equ 0x0c36          ; ADV, redraws the adventure screen
TOUPPER     equ 0x0c46          ; CRT

; ---- game data ----------------------------------------------------------------------
CURWIN      equ 0x59c8          ; pointer to the current window struct
WINCOLOUR   equ 0x01ed
TOWN_REMAP  equ 0x3007          ; slot -> town index
TOWN_SEEN   equ 0x64e5          ; indexed by town index, not by slot
CASTLE_SEEN equ 0x64cb
TOWN_NAMES  equ 0x2e25          ; word table, indexed by town index
CASTLE_NAMES equ 0x2d9e
HDR_CASTLE  equ 0x2fb1          ; the four already-translated prompt pointers
ASK_CASTLE  equ 0x2fb3
HDR_TOWN    equ 0x2fb5
ASK_TOWN    equ 0x2fb7
NONE_STR    equ 0x0d9e          ; "(none)" -- fits its own slot, so a plain `string` row

; ---- layout -------------------------------------------------------------------------
; 26 destinations at most, so two columns of 13. Each column is 17 cells: 14 for the widest
; entry ("A) Тёмный Угол") and 3 of gutter, inside a 36-cell window.
;
; Window edges snap to the 8px cell grid while the text inside them does not, and the play
; area leaves only 2 scanlines above the window and 6 below -- so this is the lowest row
; that fits, and the bottom border lands on the play frame's own line rather than short of
; it. Moving the block down any further means shrinking it.
WIN_X1      equ 2
WIN_Y1      equ 4
WIN_X2      equ 37
WIN_Y2      equ 23
TITLE_Y     equ 38
COL_L       equ 2               ; flush with the prompt below the list
COL_STEP    equ 17
ROW_Y0      equ 52
ROW_STEP    equ 9               ; 8px glyph + 1 scanline of leading
ROWS        equ 13
; The prompt tracks the list: at 13 rows the last one ends at 160, so anything above 168
; would be overdrawn by it.
ASK_Y       equ 174
SLOTS       equ 26

; ---- locals -------------------------------------------------------------------------
;   [bp-1] slot 0..25      [bp-2] entry number      [bp-3] resolved town/castle index
;   [bp-4] row             [bp-5] column            [bp-6] result

picker:
    push bp
    mov  bp,sp
    sub  sp,6
    push si
    push di
    mov  si,[bp+6]

    mov  ax,0
    push ax
    callf VID:WIN_PAGE
    pop  cx

    mov  ax,WIN_Y2
    push ax
    mov  ax,WIN_X2
    push ax
    mov  ax,WIN_Y1
    push ax
    mov  ax,WIN_X1
    push ax
    callf VID:WIN_NEW
    add  sp,8
    mov  di,ax
    or   ax,ax
    jnz  opened
    mov  al,0xff                ; all three window slots busy: cancel rather than draw junk
    jmp  leave_nowin
opened:
    mov  byte [di+8],1
    mov  al,[WINCOLOUR]
    mov  [di+7],al
    push di
    callf VID:WIN_OPEN
    pop  cx
    mov  ax,0
    push ax
    callf VID:WIN_ATTACH
    pop  cx

    mov  ax,WIN_Y2
    push ax
    mov  ax,WIN_X2
    push ax
    mov  ax,WIN_Y1
    push ax
    mov  ax,WIN_X1
    push ax
    callf ADV:FRAME
    add  sp,8

; ---- title, centred -----------------------------------------------------------------
    mov  ax,2
    push ax
    callf VID:WIN_JUST
    pop  cx
    mov  ax,TITLE_Y
    push ax
    mov  ax,0
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    or   si,si
    jz   title_castle
    mov  ax,[HDR_TOWN]
    jmp  title_put
title_castle:
    mov  ax,[HDR_CASTLE]
title_put:
    push ax
    callf VID:PUTS
    pop  cx
    mov  bx,[CURWIN]
    mov  byte [bx+0xa],0        ; back to left-justified; WIN_JUST only ever sets bits

; ---- one line per visited destination ------------------------------------------------
    mov  byte [bp-1],0
    mov  byte [bp-2],0
    mov  byte [bp-4],0
    mov  byte [bp-5],0
scan:
    or   si,si
    jz   scan_castle
    mov  al,[bp-1]
    mov  ah,0
    mov  bx,ax
    mov  al,[bx+TOWN_REMAP]
    mov  [bp-3],al
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+TOWN_SEEN],0
    jnz  scan_show
scan_skip:                      ; the loop body is past rel8, so both tests branch via here
    jmp  scan_next
scan_castle:
    mov  al,[bp-1]
    mov  [bp-3],al
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+CASTLE_SEEN],0
    jz   scan_skip

scan_show:
    mov  al,[bp-4]
    mov  ah,0
    mov  bx,ROW_STEP
    imul bx
    add  ax,ROW_Y0
    push ax
    mov  al,[bp-5]
    mov  ah,0
    mov  bx,COL_STEP
    imul bx
    add  ax,COL_L
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx

    mov  al,[bp-1]              ; the slot, so the letter names the destination
    mov  ah,0
    add  ax,0x41
    push ax
    callf VID:PUTCH
    pop  cx
    mov  ax,0x29                ; ')'
    push ax
    callf VID:PUTCH
    pop  cx
    mov  ax,0x20
    push ax
    callf VID:PUTCH
    pop  cx

    mov  al,[bp-3]
    mov  ah,0
    shl  ax,1
    mov  bx,ax
    or   si,si
    jz   name_castle
    push [bx+TOWN_NAMES]
    jmp  name_put
name_castle:
    push [bx+CASTLE_NAMES]
name_put:
    callf VID:PUTS
    pop  cx

    inc  byte [bp-2]            ; entries drawn, for the row/column walk only
    inc  byte [bp-4]
    cmp  byte [bp-4],ROWS
    jc   scan_next
    mov  byte [bp-4],0
    mov  byte [bp-5],1
scan_next:
    inc  byte [bp-1]
    cmp  byte [bp-1],SLOTS
    jnc  scan_done
    jmp  scan
scan_done:
    mov  al,[bp-2]
    or   al,al
    jnz  ask_prompt
    mov  ax,ROW_Y0              ; nothing visited: the game's own "(none)" in the list area
    push ax
    mov  ax,COL_L
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    mov  ax,NONE_STR
    push ax
    callf VID:PUTS
    pop  cx
ask_prompt:

; ---- prompt and choice ---------------------------------------------------------------
    mov  ax,ASK_Y
    push ax
    mov  ax,2
    push ax
    callf VID:GOTOXY
    pop  cx
    pop  cx
    or   si,si
    jz   ask_castle
    mov  ax,[ASK_TOWN]
    jmp  ask_put
ask_castle:
    mov  ax,[ASK_CASTLE]
ask_put:
    push ax
    callf VID:PUTS
    pop  cx

; The whole alphabet is accepted and an unlisted letter is simply re-read, so a key for a
; destination not yet visited does nothing instead of teleporting somewhere else.
ask:
    mov  ax,0x7a                ; through lowercase: the range check runs before TOUPPER,
    push ax                     ; so stopping at 'Z' would reject every unshifted key
    mov  ax,0x41
    push ax
    callf ADV:GETKEY
    pop  cx
    pop  cx
    push ax
    callf CRT:TOUPPER
    pop  cx
    cmp  al,0x1b
    jz   cancel
    sub  al,0x41
    cmp  al,SLOTS               ; '[' to '`' also survive the range check, and TOUPPER
    jnc  ask                    ; leaves them: keep them out of the coordinate tables
    mov  [bp-1],al
    or   si,si
    jz   key_castle
    mov  ah,0
    mov  bx,ax
    mov  al,[bx+TOWN_REMAP]
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+TOWN_SEEN],0
    jmp  key_test
key_castle:
    mov  ah,0
    mov  bx,ax
    cmp  byte [bx+CASTLE_SEEN],0
key_test:
    jz   ask
    mov  al,[bp-1]
    jmp  leave

cancel:
    mov  al,0xff
leave:
    mov  [bp-6],al
    push di
    callf VID:WIN_CLOSE
    pop  cx
    callf ADV:RESTORE
    mov  al,[bp-6]
leave_nowin:
    pop  di
    pop  si
    mov  sp,bp
    pop  bp
    retf
