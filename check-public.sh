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
# Every commit a push would send (not yet on origin/main) goes public whole: its author and committer must be the
# repository's public name, and neither its message nor any line it adds may carry the PATTERN above (a file taken out
# later still sits in the commit that added it).
PUBLIC_ID='Esteban Pedroza <esteban@boolean3d.com>'
if git rev-parse -q --verify origin/main >/dev/null; then
  bad=$(git log --format='%h %an <%ae> / %cn <%ce>' origin/main..HEAD | grep -v -F "$PUBLIC_ID / $PUBLIC_ID" || true)
  if [ -n "$bad" ]; then echo "check-public.sh: commits not under '$PUBLIC_ID':"; echo "$bad"; exit 1; fi
  for c in $(git rev-list origin/main..HEAD); do
    h=$({ git log -1 --format=%B $c; git show --format= -m --first-parent $c -- . ':!check-public.sh' ':!*/shared/net/ca-certificates.crt' | grep '^+'; } \
      | grep -E "$PATTERN" | grep -v -E '/home/(web_user|me)/' || true)
    if [ -n "$h" ]; then echo "check-public.sh: commit $(git log -1 --format='%h %s' $c | cut -c1-80) carries:"; echo "$h"; exit 1; fi
  done
fi
echo "check-public.sh: clean"
