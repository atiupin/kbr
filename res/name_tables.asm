; Hero-name lookup tables -- two 8086 xlat tables, no code. Assembled into DGROUP by
; apply_patches.py, which rewrites the two sites that read them; the labels are DS offsets.
;
; keymap makes Cyrillic typable with no DOS keyboard driver at all. The game reads keys
; through INT 16h, so a Russian name would otherwise need the player's own DOSBox to load
; KEYB RU -- unknowable for a patch we hand out. Instead the accepted key code is mapped
; here, by keyboard POSITION (ЙЦУКЕН), which is the layout a Russian player's fingers know.
;
; The mapping sits INSIDE the name field's accept path, which is why the rest of the game
; keeps its Latin command keys, and why the raw code is what gets mapped: Ё and ё sit on the
; tilde and backquote keys, so they never collide with the arrows, which arrive as 0xF0 and
; 0xF1 from the engine's own scancode table. Latin letters are the price -- there is no room
; in the 38-byte block for a layout toggle, so a name is Cyrillic, digits and punctuation.
;
; The one other caller of that input routine is the copy-protection prompt's "Word:" line.
; It gets ЙЦУКЕН too, which costs nothing: the answer is never compared.
;
; translit turns the finished name into the save file's 8.3 name (<name>.DAT). It is 1:1 by
; necessity, not by taste: the builder loop is one input byte, one output byte, one index,
; cut at 8 -- zh/ch/sh digraphs need a second index and an overflow check that the 6-byte
; block it now occupies cannot hold. So е/ё/э collapse to E, а/я to A, у/ю to U, й/ы to Y,
; ш/щ to W, ь/ъ to _. Two heroes can then land on one file, but never silently: the game
; already asks "destroy the game of <name>?" whenever the file exists.
;
; Both tables span their whole index range, so neither caller needs a range check. Anything
; that is not a letter or a digit becomes '_', which is what the original did to every byte
; outside A-Z -- spaces included.

; ---- keymap: key code (ASCII, 0x00-0x7F) -> the CP866 letter it types --------------------
keymap:
    db "________________"       ; 0x00  control codes: unreachable, the caller rejects < 0x20
    db "________________"       ; 0x10
    db " !Э#$%&э()*+б-ю."       ; 0x20  " -> Э, ' -> э, , -> б, . -> ю, / -> .
    db "0123456789ЖжБ=Ю,"       ; 0x30  digits stay; : ; < > ? carry Ж ж Б Ю ,
    db "@ФИСВУАПРШОЛДЬТЩ"       ; 0x40  A-O
    db "ЗЙКЫЕГМЦЧНЯх\ъ^_"       ; 0x50  P-Z, then [ -> х, ] -> ъ
    db "ёфисвуапршолдьтщ"       ; 0x60  ` -> ё, a-o
    db "зйкыегмцчняХ|ЪЁ",0x7f   ; 0x70  p-z, { -> Х, } -> Ъ, ~ -> Ё, DEL kept as itself

; ---- translit: name byte (CP866) -> save-file name byte (ASCII) --------------------------
translit:
    db "________________"       ; 0x00
    db "________________"       ; 0x10
    db "________________"       ; 0x20  space included: the original blanked it too
    db "0123456789______"       ; 0x30
    db "_ABCDEFGHIJKLMNO"       ; 0x40
    db "PQRSTUVWXYZ_____"       ; 0x50
    db "_ABCDEFGHIJKLMNO"       ; 0x60  a-z fold to upper case
    db "PQRSTUVWXYZ_____"       ; 0x70
    db "ABVGDEJZIYKLMNOP"       ; 0x80  А-П
    db "RSTUFHCQWW_Y_EUA"       ; 0x90  Р-Я
    db "ABVGDEJZIYKLMNOP"       ; 0xA0  а-п
    db "________________"       ; 0xB0  box drawing
    db "________________"       ; 0xC0
    db "________________"       ; 0xD0
    db "RSTUFHCQWW_Y_EUA"       ; 0xE0  р-я
    db "EE______________"       ; 0xF0  Ё ё
