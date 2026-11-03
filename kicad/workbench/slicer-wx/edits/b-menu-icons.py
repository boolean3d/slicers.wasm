# Menu items with icons drew the icon over the start of their label. The wasm theme's DoDrawMenuItem draws the
# icon after the item's MENU_HORZ_MARGIN (12 px), but GetMenuGeometry put the label at bitmap width + margins
# counted from 0 (and the bitmap column started at MENU_LEFT_MARGIN, so a 16 px icon only moved it 4 px).
# Now a menu with icons reserves margin + widest icon + its margins; menus without icons keep their layout.
# Run in owx.
def sub(p, a, b):
    s = open(p).read()
    if b in s: return
    assert s.count(a) == 1, (p, a)
    open(p, 'w').write(s.replace(a, b))

T = 'src/univ/themes/wasm.cpp'
sub(T, '''            widthBmpMax = MENU_LEFT_MARGIN;

    bool hasCheck = false;''', '''            widthBmpMax = MENU_LEFT_MARGIN,
            widthBmpItems = 0;  // widest item icon (0: no item has one)

    bool hasCheck = false;''')
sub(T, '''                wxCoord widthBmp = bmp.GetWidth();
                if ( widthBmp > widthBmpMax )
                    widthBmpMax = widthBmp;''', '''                wxCoord widthBmp = bmp.GetWidth();
                if ( widthBmp > widthBmpMax )
                    widthBmpMax = widthBmp;
                if ( widthBmp > widthBmpItems )
                    widthBmpItems = widthBmp;''')
sub(T, '''    gi->m_ofsLabel = widthCheck + widthBmpMax + 2*MENU_BMP_MARGIN;''', '''    gi->m_ofsLabel = widthCheck + widthBmpMax + 2*MENU_BMP_MARGIN;
    // icons are drawn after the item's horizontal margin (DoDrawMenuItem), so the label goes after both
    if ( widthBmpItems > 0 )
        gi->m_ofsLabel = MENU_HORZ_MARGIN + widthCheck + widthBmpItems + 2*MENU_BMP_MARGIN;''')
