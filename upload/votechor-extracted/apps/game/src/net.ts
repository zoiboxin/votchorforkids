import { Client, CloseCode, type Room } from "@colyseus/sdk";
import { toast, useGame } from "./store";
import { sfx, startAudio } from "./audio";

const URL = import.meta.env.VITE_SERVER_URL ?? `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
let client: Client | null = null;
let room: Room<any, any> | null = null;
export const getRoom = () => room;

export async function connect() {
  const { look, name } = useGame.getState();
  startAudio(); // must run inside the click handler (browser autoplay policy)
  useGame.setState({ screen: "connecting", error: "" });
  try {
    client = new Client(URL);
    room = await client.joinOrCreate("city", { ...look, name: name || "Guest" });
    sessionStorage.setItem("vc-token", room.reconnectionToken);
    bind(room);
    useGame.setState({ screen: "play", online: true });
    toast("Welcome to the protest. The Parliament is to the north. Run!");
  } catch (e) {
    useGame.setState({ screen: "error", error: e instanceof Error ? e.message : "Could not reach the game server." });
  }
}

export const squadAction = (action: "create" | "join" | "leave", code?: string) => room?.send("squad", { action, ...(code ? { code } : {}) });
export const interact = () => room?.send("interact", {});

export function leave() {
  room?.leave(); room = null; useGame.setState({ screen: "creator", ids: [] });
}

function bind(r: Room<any, any>) {
  r.onMessage("hit", (m: { msg: string }) => { toast(m.msg); sfx.bump(); });
  r.onMessage("notice", (m: { msg: string }) => toast(m.msg));
  let sig = "";
  r.onMessage("pickup", (m: { msg: string }) => { toast(m.msg); sfx.pickup(); });
  r.onStateChange(() => {
    const ids: string[] = [];
    r.state.players.forEach((_: unknown, id: string) => ids.push(id));
    const s = ids.join(",");
    if (s !== sig) { sig = s; useGame.setState({ ids }); }
  });
  r.onLeave(async (code: number) => {
    if (code === CloseCode.CONSENTED || !client) return;
    useGame.setState({ online: false });
    const token = sessionStorage.getItem("vc-token");
    for (let i = 0; i < 6 && token; i++) {
      try {
        room = await client.reconnect(token);
        sessionStorage.setItem("vc-token", room.reconnectionToken);
        bind(room);
        useGame.setState({ online: true });
        toast("Reconnected. Democracy resumed.");
        return;
      } catch { await new Promise((res) => setTimeout(res, 2000)); }
    }
    room = null;
    useGame.setState({ screen: "error", error: "Connection lost and could not be restored." });
  });
}
