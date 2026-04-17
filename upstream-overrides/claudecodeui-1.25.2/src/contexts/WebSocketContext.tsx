import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/auth/context/AuthContext';
import {
  createDiagnosticsId,
  recordConnectivityEvent,
} from '../utils/debugDiagnostics';

type WebSocketContextType = {
  ws: WebSocket | null;
  sendMessage: (message: any) => void;
  latestMessage: any | null;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const buildWebSocketUrl = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new URL(`${protocol}//${window.location.host}/ws`).toString();
};

const QUEUEABLE_MESSAGE_TYPES = new Set([
  'check-session-status',
  'get-desktop-approvals',
  'get-pending-permissions',
  'get-pending-interactions',
  'get-active-sessions',
  'interaction-response',
  'abort-session',
]);

const CLIENT_HEARTBEAT_INTERVAL_MS = 4000;
const RECONNECT_DELAY_MS = 3000;

const getQueueKey = (message: any) => {
  const type = String(message?.type || '');
  const sessionId = String(message?.sessionId || '');
  const interactionId = String(message?.interactionId || message?.requestId || '');
  return `${type}:${sessionId}:${interactionId}`;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  const wsRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const hasConnectedRef = useRef(false);
  const queuedMessagesRef = useRef<string[]>([]);
  const activeConnectionIdRef = useRef<string | null>(null);
  const [latestMessage, setLatestMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { user, isLoading: isAuthLoading } = useAuth();

  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    try {
      const wsUrl = buildWebSocketUrl();
      const connectionId = createDiagnosticsId('ws');
      activeConnectionIdRef.current = connectionId;

      recordConnectivityEvent({
        connectionId,
        event: 'ws_connect_start',
        detail: {
          url: wsUrl,
          reconnect: hasConnectedRef.current,
        },
      });

      const websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        setIsConnected(true);
        wsRef.current = websocket;
        clearHeartbeat();

        heartbeatIntervalRef.current = setInterval(() => {
          if (websocket.readyState !== WebSocket.OPEN) {
            return;
          }

          websocket.send(JSON.stringify({
            type: 'ping',
            timestamp: Date.now(),
          }));
        }, CLIENT_HEARTBEAT_INTERVAL_MS);

        const queuedMessages = queuedMessagesRef.current.splice(0);
        queuedMessages.forEach((payload) => websocket.send(payload));

        recordConnectivityEvent({
          connectionId,
          event: 'ws_open',
          detail: {
            queuedMessages: queuedMessages.length,
            reconnect: hasConnectedRef.current,
          },
        });

        if (hasConnectedRef.current) {
          setLatestMessage({ type: 'websocket-reconnected', timestamp: Date.now() });
          recordConnectivityEvent({
            connectionId,
            event: 'ws_reconnect_success',
            detail: null,
          });
        }

        hasConnectedRef.current = true;
      };

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data?.type === 'pong') {
            return;
          }
          setLatestMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      websocket.onclose = (event) => {
        setIsConnected(false);
        wsRef.current = null;
        clearHeartbeat();

        recordConnectivityEvent({
          connectionId,
          event: 'ws_close',
          detail: {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          },
        });

        recordConnectivityEvent({
          connectionId,
          event: 'ws_reconnect_scheduled',
          detail: {
            delayMs: RECONNECT_DELAY_MS,
          },
        });

        reconnectTimeoutRef.current = setTimeout(() => {
          if (unmountedRef.current) return;
          connect();
        }, RECONNECT_DELAY_MS);
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        recordConnectivityEvent({
          connectionId,
          event: 'ws_error',
          detail: {
            type: error.type || 'error',
          },
        });
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      recordConnectivityEvent({
        connectionId: activeConnectionIdRef.current,
        event: 'ws_connect_exception',
        detail: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }, [clearHeartbeat]);

  useEffect(() => {
    if (isAuthLoading || !user) {
      return;
    }

    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearHeartbeat();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearHeartbeat, connect, isAuthLoading, user]);

  useEffect(() => {
    const handleOnline = () => {
      recordConnectivityEvent({
        connectionId: activeConnectionIdRef.current,
        event: 'browser_online',
        detail: null,
      });
    };

    const handleOffline = () => {
      recordConnectivityEvent({
        connectionId: activeConnectionIdRef.current,
        event: 'browser_offline',
        detail: null,
      });
    };

    const handleVisibilityChange = () => {
      recordConnectivityEvent({
        connectionId: activeConnectionIdRef.current,
        event: 'visibility_change',
        detail: {
          visibilityState: document.visibilityState,
        },
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const sendMessage = useCallback((message: any) => {
    const socket = wsRef.current;
    const payload = JSON.stringify(message);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else {
      if (message?.type && QUEUEABLE_MESSAGE_TYPES.has(String(message.type))) {
        const queueKey = getQueueKey(message);
        const filteredQueue = queuedMessagesRef.current.filter((queuedPayload) => {
          try {
            return getQueueKey(JSON.parse(queuedPayload)) !== queueKey;
          } catch {
            return true;
          }
        });
        filteredQueue.push(payload);
        queuedMessagesRef.current = filteredQueue;
        if (queuedMessagesRef.current.length > 20) {
          queuedMessagesRef.current.splice(0, queuedMessagesRef.current.length - 20);
        }
        recordConnectivityEvent({
          connectionId: activeConnectionIdRef.current,
          sessionId: typeof message?.sessionId === 'string' ? message.sessionId : null,
          event: 'ws_message_queued',
          detail: {
            type: String(message.type),
            queuedCount: queuedMessagesRef.current.length,
          },
        });
        return;
      }

      recordConnectivityEvent({
        connectionId: activeConnectionIdRef.current,
        sessionId: typeof message?.sessionId === 'string' ? message.sessionId : null,
        event: 'ws_send_blocked',
        detail: {
          type: String(message?.type || 'unknown'),
        },
      });
      console.warn('WebSocket not connected');
    }
  }, []);

  const value: WebSocketContextType = useMemo(() => ({
    ws: wsRef.current,
    sendMessage,
    latestMessage,
    isConnected,
  }), [sendMessage, latestMessage, isConnected]);

  return value;
};

export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
