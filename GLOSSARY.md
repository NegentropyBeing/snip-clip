# snip-clip

A desktop app that cuts micro-clips from game recordings and exports them ready to share, sized for Discord by default.

## Language

### Recording

**Replay profile** (pt-BR: *perfil de replay*):
The OBS setup snip-clip installs: an OBS profile and a scene collection, both named "snip-clip Replay", that keep a replay buffer running and give each audio source its own named track.
_Avoid_: OBS profile (only one of its two parts), profile alone

**Replays folder** (pt-BR: *pasta de replays*):
Where OBS saves replays; an option of the replay profile.
_Avoid_: output folder, recordings folder

### Opening

**Open folder** (pt-BR: *pasta de abertura*):
Where the "Open video" dialog starts. Follows the replays folder unless set to another place.
_Avoid_: default folder, videos folder

### Exporting

**Preset**:
A named set of export settings: codec, audio handling and an optional size limit.
_Avoid_: profile

**Export folder** (pt-BR: *pasta de exportação*):
Where exported clips are saved.
_Avoid_: output folder, clips folder
