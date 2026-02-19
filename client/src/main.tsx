import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/components.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
