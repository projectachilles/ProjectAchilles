# ProjectAchilles appliance: show the admin menu on interactive logins of the
# "achilles" user. POSIX sh; sourced by login shells, so it never terminates
# the shell, and it does nothing for other users or non-interactive shells.
case "$-" in
*i*)
	if [ "$(id -un 2>/dev/null)" = "achilles" ] &&
		[ -x /opt/projectachilles/achilles-installer ] &&
		[ -t 0 ] && [ -z "${ACHILLES_MENU_RUNNING:-}" ]; then
		ACHILLES_MENU_RUNNING=1
		export ACHILLES_MENU_RUNNING
		/opt/projectachilles/achilles-installer appliance menu
	fi
	;;
esac
