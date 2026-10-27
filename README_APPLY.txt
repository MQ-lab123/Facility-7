FACILITY-7 Multiplayer Combat Fix Bundle

Files:
- FACILITY7_multiplayer_forfeit_combat_fixed.html: updated client HTML
- server.js: updated multiplayer server

Apply both files:
1. Replace the client HTML used by your game with the included HTML file.
2. Replace the multiplayer Render service's server.js with the included server.js and deploy it.
3. Test with two browser sessions: switch to melee with key 3 or the mouse wheel, punch the other player, throw a grenade, and close one session during a PvP match.

Validation performed: Node syntax check passed for server.js and extracted inline scripts. Actual two-client online gameplay has not been tested here.
