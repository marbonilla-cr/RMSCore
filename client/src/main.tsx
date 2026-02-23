import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/admin.css";
import "./index.css";
import { getSessionToken } from "./lib/queryClient";

const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const token = getSessionToken();
  if (token) {
    const headers = new Headers(init?.headers || {});
    if (!headers.has("X-Session-Token")) {
      headers.set("X-Session-Token", token);
    }
    return originalFetch(input, { ...init, headers });
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById("root")!).render(<App />);
