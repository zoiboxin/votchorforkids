import { Canvas } from "@react-three/fiber";
import { Actors, BossArena, Env, Creatures, Items, Me, Preview, useControls } from "./Game";
import { World } from "./World";
import { Creator } from "./Creator";
import { Hud } from "./Hud";
import { connect } from "./net";
import { useGame } from "./store";

export default function App() {
  useControls();
  const screen = useGame((s) => s.screen), look = useGame((s) => s.look), error = useGame((s) => s.error);
  const playing = screen === "play";
  return (<>
    <Canvas className="cv" camera={{ fov: 65, near: 1, far: 900 }} dpr={[1, 1.5]} gl={{ antialias: true }}
      onMouseDown={(e) => { if (playing) try { (e.target as HTMLCanvasElement).requestPointerLock(); } catch { /* optional */ } }}>
      <Env /><World />
      {playing ? <><Me /><Actors /><Items /><Creatures /><BossArena /></> : <Preview look={look} />}
    </Canvas>
    {screen === "creator" && <Creator />}
    {screen === "connecting" && <div className="center pan">Connecting to the city…</div>}
    {screen === "error" && (<div className="center pan"><h2>Can’t reach the game server</h2><p>{error}</p>
      <button className="go" onClick={connect}>Try again</button><button className="link" onClick={() => useGame.setState({ screen: "creator" })}>Back to character</button></div>)}
    {playing && <Hud />}
  </>);
}
