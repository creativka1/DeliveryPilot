"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Video,
  Play,
  Square,
  Loader2,
  RefreshCw,
  AlertCircle,
  History,
  Camera,
} from "lucide-react";
import { Button } from "./ui/button";
import type { AppState } from "@/lib/state";
type Props = {
  cameras: AppState["cameras"];
  configured: boolean;
  canConnect: boolean;
  onConnect: () => Promise<unknown>;
  onError: (s: string) => void;
};
export function RingViewer({
  cameras,
  configured,
  canConnect,
  onConnect,
  onError,
}: Props) {
  const [selected, setSelected] = useState(""),
    [phase, setPhase] = useState<"idle" | "connecting" | "live">("idle"),
    [remaining, setRemaining] = useState(0),
    [history, setHistory] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    peer = useRef<RTCPeerConnection | null>(null),
    session = useRef<string | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    generation = useRef(0);
  const selectedId =
    selected ||
    cameras.find((c) => c.supportsVideo)?.externalId ||
    cameras[0]?.externalId ||
    "";
  const device = cameras.find((c) => c.externalId === selectedId);
  const cleanup = useCallback(async () => {
    generation.current++;
    if (timer.current) clearInterval(timer.current);
    if (timeout.current) clearTimeout(timeout.current);
    peer.current?.close();
    peer.current = null;
    if (video.current) video.current.srcObject = null;
    setPhase("idle");
    setRemaining(0);
    const id = session.current;
    session.current = null;
    if (id)
      try {
        await fetch("/api/ring/stream", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
          keepalive: true,
        });
      } catch {
        /* Upstream sessions are limited by Ring even when client cleanup cannot reach the server. */
      }
  }, []);
  useEffect(
    () => () => {
      void cleanup();
    },
    [cleanup],
  );
  const start = async () => {
    await cleanup();
    const token = ++generation.current;
    setNotice("");
    setPhase("connecting");
    try {
      if (!window.RTCPeerConnection)
        throw new Error("This browser does not support WebRTC.");
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      peer.current = pc;
      // Match the SDP media sections used by Amazon's official Ring starter.
      pc.addTransceiver("audio", { direction: "sendrecv" });
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.ontrack = (event) => {
        if (token === generation.current && video.current)
          video.current.srcObject =
            event.streams[0] ?? new MediaStream([event.track]);
      };
      pc.onconnectionstatechange = () => {
        if (
          token === generation.current &&
          ["failed", "disconnected"].includes(pc.connectionState)
        ) {
          setNotice(
            "The Ring media connection ended. Start a new session to reconnect.",
          );
          void cleanup();
        }
      };
      // Amazon's official Ring starter proceeds after a brief ICE gathering wait
      // rather than rejecting the stream when gathering is still in progress.
      await pc.setLocalDescription(
        await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true }),
      );
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        const iceTimeout = setTimeout(() => {
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }, 3000);
        function check() {
          if (pc.iceGatheringState === "complete") {
            clearTimeout(iceTimeout);
            pc.removeEventListener("icegatheringstatechange", check);
            resolve();
          }
        }
        pc.addEventListener("icegatheringstatechange", check);
      });
      if (token !== generation.current) return;
      const r = await fetch("/api/ring/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: selectedId,
          sdpOffer: pc.localDescription?.sdp,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Ring stream creation failed.");
      if (token !== generation.current) {
        await fetch("/api/ring/stream", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: data.sessionId }),
        });
        return;
      }
      session.current = data.sessionId;
      await pc.setRemoteDescription({ type: "answer", sdp: data.sdpAnswer });
      setRemaining(30);
      const ends = Date.now() + 30000;
      timer.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
        setRemaining(left);
        if (!left) {
          setNotice(
            "This 30-second viewing session has ended. Start another session to reconnect.",
          );
          void cleanup();
        }
      }, 1000);
      timeout.current = setTimeout(() => {
        if (video.current?.readyState === 0) {
          setNotice(
            "Ring created a WHEP session, but no media arrived. Check WebRTC connectivity and the selected sample.",
          );
          void cleanup();
        }
      }, 15000);
    } catch (e) {
      onError(
        e instanceof Error ? e.message : "Could not open the Ring stream.",
      );
      await cleanup();
    }
  };
  const discover = async () => {
    setBusy(true);
    try {
      await onConnect();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  };
  const loadHistory = async () => {
    setBusy(true);
    try {
      const r = await fetch(
        `/api/ring/history?deviceId=${encodeURIComponent(selectedId)}`,
      );
      const p = await r.json();
      if (!r.ok) throw new Error(p.error);
      setHistory(JSON.stringify(p.data, null, 2));
    } catch (e) {
      onError(e instanceof Error ? e.message : "History unavailable.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="video-stage">
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          controls={phase === "live"}
          onPlaying={() => setPhase("live")}
          className={phase === "idle" ? "video-hidden" : ""}
          aria-label="Real Ring WHEP video"
        />
        {phase === "idle" && (
          <div className="video-empty">
            <span>
              <Camera size={39} strokeWidth={1.2} />
            </span>
            <h3>
              {cameras.length
                ? "Your entrance is ready to view."
                : "Connect a real Ring camera."}
            </h3>
            <p>
              {configured
                ? "Discover your devices, map a receiving entrance, and start a live session."
                : "Add your Playground token to the server to discover available Package, Vehicle, and Motion sample devices."}
            </p>
            <Button
              variant="outline"
              onClick={() => void discover()}
              disabled={busy || !canConnect}
            >
              {busy ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              Discover Ring devices
            </Button>
            <small>
              {canConnect
                ? "No camera footage is simulated in this player."
                : "Ask a manager to discover or reconnect Ring devices."}
            </small>
          </div>
        )}
        {phase === "connecting" && (
          <div className="video-connecting">
            <Loader2 className="spin" size={27} />
            <p>Connecting to Ring WHEP…</p>
            <Button variant="outline" size="sm" onClick={() => void cleanup()}>
              Cancel
            </Button>
          </div>
        )}
        {phase === "live" && (
          <div className="video-live">
            <span />
            REAL RING VIDEO <b>{remaining}s</b>
          </div>
        )}
      </div>
      <div className="video-controls">
        <select
          aria-label="Ring camera"
          value={selectedId}
          disabled={phase !== "idle"}
          onChange={(e) => {
            setSelected(e.target.value);
            setHistory(null);
          }}
        >
          {!cameras.length && (
            <option value="">No Ring devices discovered</option>
          )}
          {cameras.map((c) => (
            <option key={c.id} value={c.externalId}>
              {c.name}
              {c.supportsVideo ? "" : " · no video capability"}
            </option>
          ))}
        </select>
        {phase === "idle" ? (
          <Button
            size="sm"
            disabled={!device?.supportsVideo || busy}
            onClick={() => void start()}
          >
            <Play size={14} />
            Start live view
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void cleanup()}>
            <Square size={13} />
            Stop
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={busy || !canConnect}
          aria-label="Refresh Ring devices"
          onClick={() => void discover()}
        >
          <RefreshCw size={15} />
        </Button>
      </div>
      {device && (
        <div className="device-info">
          <span
            className={
              device.online === true
                ? "online-dot"
                : device.online === false
                  ? "offline-dot"
                  : "neutral-dot"
            }
          />
          {device.online === true
            ? "Online"
            : device.online === false
              ? "Offline"
              : "Status unknown"}
          <span className="dot-separator">·</span>
          {device.location?.name ?? "Unmapped entrance — map it in Settings"}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void loadHistory()}
          >
            <History size={13} />
            Fetch event history
          </Button>
        </div>
      )}
      {notice && (
        <div className="video-notice">
          <AlertCircle size={15} />
          {notice}
        </div>
      )}
      {history && (
        <div className="history-response">
          <div className="flex-between">
            <strong>Real Ring API event history</strong>
            <Button size="sm" variant="ghost" onClick={() => setHistory(null)}>
              Close
            </Button>
          </div>
          <p>Raw documented history response. Not treated as a new webhook.</p>
          <pre>{history}</pre>
        </div>
      )}
      <div className="video-privacy">
        <Video size={14} />
        Video streams directly through WebRTC. DeliveryPilot stores no video.
        Sessions close after 30 seconds.
      </div>
    </div>
  );
}
