# frangellboom

## Dev server / ports

- This project's dev server is pinned to **port 5174** (`server.port` + `strictPort: true` in `vite.config.ts`). **Port 5173 belongs to a different local project on this machine — never touch it.**
- Never run `pkill -f "vite"` or any other broad/blanket process kill — it kills vite dev servers for *all* projects on the machine, not just this one. To stop this project's dev server, kill the specific PID you started (e.g. capture it with `... & PID=$!` then `kill $PID`), or find it scoped to port 5174 specifically (e.g. `lsof -ti:5174 | xargs kill`).
