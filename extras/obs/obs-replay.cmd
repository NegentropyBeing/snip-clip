@echo off
rem Starts OBS in the "clip-snip Replay" profile with the replay buffer running.
rem Save the last minutes with Alt+F10. Create the profile first with obs-setup.py.
cd /d "%ProgramFiles%\obs-studio\bin\64bit" || (echo OBS not found in "%ProgramFiles%\obs-studio" & pause & exit /b 1)
start "" obs64.exe --profile "clip-snip Replay" --collection "clip-snip Replay" --startreplaybuffer --disable-shutdown-check
