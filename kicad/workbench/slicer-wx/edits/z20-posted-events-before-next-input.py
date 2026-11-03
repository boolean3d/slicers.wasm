# Events posted while handling one browser input run before the next browser input, as wx's own manual event loop
# does (wxEventLoopManual::ProcessEvents: "process pending wx events first as they correspond to low-level events
# which happened before", then dispatch one native event). The port emptied its whole input queue first, so a click
# whose press and release arrived together had its release handled BEFORE anything its press posted. Orca's 2-level
# filament list (Widgets/DropDown.cpp: the open sub list holds the mouse; pressing on the main)
# list closes the sub list and wxPopupWindowHandler::OnLeftDown wxPostEvent()s the press to the main list; the
# release came first and went nowhere, then the posted press set pressedDown + CaptureMouse() with no release ever
# after: the list stopped following the mouse, the pick was not applied, and the capture stayed on the hidden list,
# so the program took no clicks at all. Same popup in Bambu Studio and PrusaSlicer. Run in owx or pwx (after z15).
app = 'src/wasm/app.cpp'
s = open(app).read()
a = '''        if (press)
            ++s_pressDepth;
        handler();
        if (press)
            --s_pressDepth;
    }
}'''
b = '''        if (press)
            ++s_pressDepth;
        handler();
        if (press)
            --s_pressDepth;
        // what the handler posted (wxPostEvent, CallAfter) runs before the next input, as in wxEventLoopManual (z20)
        if (wxTheApp)
            wxTheApp->ProcessPendingEvents();
    }
}'''
if b not in s:
    assert s.count(a) == 1, (app, a[:40])
    open(app, 'w').write(s.replace(a, b))
