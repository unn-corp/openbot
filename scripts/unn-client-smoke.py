#!/usr/bin/env python3
"""Launch the installed UNN desktop runtime in Xvfb with a fresh profile."""
import json, os, pathlib, subprocess, tempfile, time
root = pathlib.Path('/mnt/Storage/Applications/OpenBot-UNN')
report = pathlib.Path('/mnt/Storage/Projects/Unnamed/openbot/.openbot-build/unn-client-smoke.json')
report.parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir='/mnt/Storage/tmp', prefix='profile-') as d:
    profile = pathlib.Path(d)
    env = dict(os.environ)
    for key in ('APPIMAGE','APPDIR','WAYLAND_DISPLAY'):
        env.pop(key, None)
    env.update(TMPDIR=d, CODEX_HOME=d+'/codex-home', CLAUDE_CONFIG_DIR=d+'/claude-home',
               OPENBOT_CODEX_PATH=d+'/missing-codex', OPENBOT_CLAUDE_PATH=d+'/missing-claude', OPENBOT_GROK_PATH=d+'/missing-grok')
    with (profile/'stderr.log').open('w') as log:
        child = subprocess.Popen([str(root/'bin/unn-client'), '--ozone-platform=x11', '--user-data-dir='+d], env=env, stdout=subprocess.DEVNULL, stderr=log)
        try:
            deadline = time.monotonic()+45
            while time.monotonic()<deadline:
                if child.poll() is not None:
                    raise RuntimeError('Client exited before its renderer called main: '+str(child.returncode)+'\n'+(profile/'stderr.log').read_text()[-4000:])
                trace = profile/'logs/trace.ndjson'
                if trace.exists() and '"kind":"ipc"' in trace.read_text():
                    report.write_text(json.dumps({'result':'pass','runtime':str((root/'current').resolve()),'rendererCalledMain':True,'isolatedProfile':True,'sandboxDisabled':False},indent=2)+'\n')
                    print('PASS: downloaded client launched with sandbox; renderer called main in an isolated profile.')
                    break
                time.sleep(.2)
            else:
                raise RuntimeError('Renderer did not call main within 45 seconds.')
        finally:
            child.terminate()
            try: child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait(timeout=5)
