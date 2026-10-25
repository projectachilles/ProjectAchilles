# Walks the real achilles-installer wizard (in a throwaway container, see
# sandbox.sh) through all ten screens and saves the eight screenshots used by
# wiki/docs/deployment/server-installer.md. Run from the repository root:
#
#   SANDBOX_DNS=1.1.1.1 vhs docs/deployment/vhs/onprem-wizard.tape
#
# Placeholder values only: achilles.corp.example.com, Clerk
# pk_test_<base64 of "clerk.example.com$"> and a fake sk_test_xxx.

Set Shell bash
Set FontFamily "JetBrainsMono Nerd Font"
Set FontSize 16
Set Width 1000
Set Height 600
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 10ms
Set WaitTimeout 90s

# Start the sandbox server (copies HEAD and installer/dist into a container).
Hide
Type "bash docs/deployment/vhs/sandbox.sh"
Enter
Wait+Screen /Press enter to start/
Show
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-welcome.png
Sleep 1s

# 2/10 Preflight: wait until every check has finished.
Enter
Wait+Screen /\d+ passed .* failed/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-preflight.png
Sleep 1s

# 3/10 Network & name: interface, hostname, DNS check, LAN subnets.
Enter
Wait+Screen /Which interface/
Enter
Wait+Screen /Server hostname/
Type "achilles.corp.example.com"
Wait+Screen /public name servers/
Enter
Wait+Screen /resolves to 10\.0\.5\.20/
Enter
Wait+Screen /LAN subnets allowed/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-network.png
Sleep 1s

# 4/10 Certificates: ProjectAchilles CA, then the zone question.
Enter
Wait+Screen /How should HTTPS certificates be issued/
Enter
Wait+Screen /Which DNS zone may the CA issue/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-certificates.png
Sleep 1s
Enter
Wait+Screen /Also allow the LAN IP/
Enter

# 5/10 Login (Clerk): placeholder development keys; the secret is masked.
Wait+Screen /Clerk publishable key/
Type "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"
Enter
Type "sk_test_xxx"
Wait+Screen /reachable from this server/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-login.png
Sleep 1s
Enter

# 6/10 Analytics: self-hosted Elasticsearch, no demo data.
Wait+Screen /Where should Elasticsearch run/
Enter
Wait+Screen /Load demo data/
Enter

# 7/10 Organisation.
Wait+Screen /Organisation name/
Type "Example Corp"
Enter
Enter
Enter
Enter

# 8/10 Review.
Wait+Screen /Write the settings and install/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-review.png
Sleep 1s

# 9/10 Install (render-only: Docker phases are skipped).
Enter
Wait+Screen /Press enter for the next steps/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-install.png
Sleep 1s

# 10/10 Done.
Enter
Wait+Screen /Windows thumbprint/
Sleep 500ms
Screenshot wiki/static/img/screenshots/onprem-done.png
Sleep 1s

# Finish; the container and its copy of the repo are removed.
Hide
Enter
Sleep 2s
