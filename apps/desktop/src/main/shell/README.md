# main/shell

Sandboxed shell execution for the `run_shell` tool. Locks cwd to the workspace, scrubs env, enforces timeouts, caps output size, optionally allowlists PATH. Streams output to the embedded xterm.js terminal in the renderer.
