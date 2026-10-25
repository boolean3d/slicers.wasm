#!/bin/bash
# Fails when a file meant for the public repository carries something that belongs only to the machines it was
# built on: home-folder paths, host names, people's notes, work-session names, keys. Run by sync-workbench.sh after
# every sync, and before a push:   bash check-public.sh
set -uo pipefail
cd "$(dirname "$0")"
# Session tags look like "(slicer-net, ...)" or "supervisor-37"; paths like ~/cad-bench or /home/<user>.
PATTERN='cad-bench|flex5|briefs/|his (rule|word|ruling)|ts\.net|/home/[a-z]+/|epedroza|Esteban|supervisor-?[0-9]|slicer-(net|looks|links|print|orca|prusa|public|lazy)(-[0-9]+)?[ ,)]|research/(orca|bambu|prusa|slicer)|proof/|BEGIN [A-Z ]*PRIVATE KEY|sk_live_|sk_test_|eyJhbGciOi'
# /home/web_user is the slicer's own home folder inside the browser; /home/me is Expat's install example.
hits=$(git grep --untracked -n -I -E "$PATTERN" -- . ':!check-public.sh' ':!*/shared/net/ca-certificates.crt' | grep -v -E '/home/(web_user|me)/' || true)
if [ -n "$hits" ]; then echo "check-public.sh: not for the public repository:"; echo "$hits"; exit 1; fi
echo "check-public.sh: clean"
