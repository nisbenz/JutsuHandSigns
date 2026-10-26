import { useCallback, useEffect, useRef } from "react";

// Opens a websocket while `active`, sends `startMessage` once connected, then
// streams the webcam as JPEG frames every `intervalMs`. `onMessage(msg, stop)`
// gets every parsed reply; calling `stop()` ends streaming and closes the
// socket. The socket reconnects only when `active`, `url` or the start
// message's contents change. Returns `send(msg)` for extra messages (rematch).
export function useFrameSocket({
  url,
  videoRef,
  active,
  startMessage,
  onMessage,
  onError,
  intervalMs = 80,
  quality = 0.85,
}) {
  const wsRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  const startRef = useRef(startMessage);
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;
  startRef.current = startMessage;
  const startKey = JSON.stringify(startMessage);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let interval = 0;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    const canvas = document.createElement("canvas");

    const stop = () => {
      stopped = true;
      clearInterval(interval);
      ws.close();
    };

    const sendFrame = () => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || ws.readyState !== WebSocket.OPEN) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      ws.send(JSON.stringify({ type: "frame", image: canvas.toDataURL("image/jpeg", quality) }));
    };

    ws.onopen = () => {
      if (stopped) return;
      ws.send(JSON.stringify(startRef.current));
      interval = setInterval(sendFrame, intervalMs);
    };
    ws.onmessage = (event) => {
      if (stopped) return;
      onMessageRef.current?.(JSON.parse(event.data), stop);
    };
    ws.onerror = () => {
      if (!stopped) onErrorRef.current?.();
    };

    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, url, startKey, intervalMs, quality]);

  return useCallback((msg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);
}
