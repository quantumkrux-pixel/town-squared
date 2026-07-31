# Town-Squared — living town game

Web-based, mobile-first fantasy town sim. Vanilla JS ES modules, no build step, Three.js r128 from CDN, Supabase Realtime for multiplayer.

## Run it

```bash
cd fantasy-town
python3 -m http.server 8000
# open http://localhost:8000  (or your phone at http://<lan-ip>:8000)
```

ES modules and `fetch` require HTTP — `file://` won't work.

**Controls:** drag to rotate the camera (full 360°, pitch locked), pinch or scroll to zoom, tap/click the ground to walk. Movement is click-to-move only.

Works immediately in **offline mode**: a simulated peer ("Wandering Spirit") circles the well so you can see remote-player interpolation without any backend. Two deterministic NPCs walk their routes — their positions are computed from wall-clock time, so every client (and any client joining later) sees them in the same place with zero network traffic. That's the pattern to extend for shop hours, crops, and day cycles.

## Go multiplayer

1. Create a Supabase project (free tier is fine — Realtime Broadcast needs no tables and no schema).
2. Paste your project URL and anon key into `src/config.js`.
3. Open the page in two browsers/devices. Done.

Player positions ride **Broadcast channels** at 10Hz (ephemeral, never touch the database) with **Presence** handling join/leave. Persistent world state — plot ownership, placed buildings, inventory — belongs in Postgres tables behind RLS with table subscriptions; the `NetworkManager` is the place to add that layer, same pattern as your Crucible3D license enforcement.

## Swapping in your own models (the important part)

The map (`data/town.json`) only references **asset IDs** — never geometry:

```json
{ "asset": "house_small", "x": 6, "z": -5, "rotY": -0.4 }
```

`src/AssetRegistry.js` resolves each ID to either a procedural placeholder or a GLB. To replace a placeholder:

1. Drop your model in `assets/models/`
2. Set the `url` on the entry:

```js
house_small: { url: 'assets/models/house_small.glb', build: buildHouseSmall, footprint: 3.4, collider: 2.0 },
```

That's it. Every instance on the map — and on every client — swaps. No re-placement. The registry auto-normalises the GLB: uniform-scales it so its XZ footprint matches `footprint` metres and rests its base on y=0, so authoring scale doesn't matter. The placeholder stays as a fallback if the file fails to load.

Characters (`char_player`, `char_remote`, `char_npc`) are assets too — swap in rigged GLBs the same way. Animation clips from GLBs are stashed on `template.userData.animations`, ready for an `AnimationMixer` when you add walk cycles.

## Town editor (admin panel)

Click the 🔧 button (bottom-right) or press `` ` `` (backtick) to enter edit mode:

- **Place:** pick an asset in the palette, then tap the ground. It stays armed so you can paint trees rapidly — Esc to disarm.
- **Select:** tap any placed object (gold ring shows selection).
- **Move:** drag the selected object across the map. Snap-to-0.5m grid is on by default.
- **Rotate / scale / duplicate / delete** from the panel, or keys: `R` rotate, `Shift+R` reverse, `Delete` remove.
- **Height nudge:** ▲/▼ buttons raise or lower the selected object in 0.1m steps — for models whose origin sits oddly and end up half-buried or floating. Saved per placement as `y` in town.json.
- **Models section:** swap any asset ID for one of your own `.glb` files. Pick the file and every instance on the map re-renders with it instantly (a live preview via a temporary blob URL). To make it permanent: copy the `.glb` into `assets/models/`, hit **Export models.json**, and save it as `data/models.json` — it's applied automatically on every boot. Player/remote characters pick up their new model on the next reload.
- **Export** downloads the live world as `town.json` (and copies it to the clipboard). Save it over `data/town.json` and the layout is permanent.

If a model is buried the same amount everywhere, fix it once for the whole asset instead of per placement — `data/models.json` entries accept an object form with an asset-wide vertical correction:

```json
{
  "house_small": { "url": "assets/models/house_small.glb", "yOffset": 0.15 },
  "tree_pine": "assets/models/pine.glb"
}
```

The scaffold shows the wrench to everyone — gate `new Editor(...)` in `main.js` behind a Supabase auth/role check before going public. When the map moves into a Supabase table, the only editor change is pointing Export (or per-edit saves) at an upsert instead of a file download — every player then sees your edits live via a table subscription.

## File map

```
index.html                 demo shell + HUD
data/town.json             the town: placements, roads, NPC routes (pure data)
src/config.js              Supabase keys, camera/player/net tuning
src/main.js                boot, scene, lighting, game loop, input
src/AssetRegistry.js       asset ID → placeholder or GLB   ← swap point
src/World.js               builds scene from town.json, colliders, NPCs
src/CameraRig.js           locked-pitch 360° orbit, touch gestures
src/Player.js              tap-to-move + WASD, collision, name tags
src/RemotePlayers.js       snapshot-buffer interpolation of peers
src/net/NetworkManager.js  Supabase Realtime + offline stub
src/Editor.js              in-game admin panel (place/move/export)
```

## Sensible next steps

- **Persistent map in Supabase:** move `town.json` contents into a `placements` table; `World.load()` swaps its `fetch` for a Supabase query, and a table subscription live-adds buildings other players place.
- **Instancing:** placeholders are cloned meshes (fine for ~60 objects); switch trees/lamps to `InstancedMesh` when the town grows.
- **Animation:** `AnimationMixer` per character once rigged GLBs land; drive walk/idle from the `m` flag already in the network state.
- **Interactions:** raycast placements instead of just ground — tap a building to enter/inspect; `userData.assetId` is already on every instance.
- **Day/night:** drive `sun` position + hemisphere color from wall-clock time — deterministic, synced for free, and the lamps already glow.
