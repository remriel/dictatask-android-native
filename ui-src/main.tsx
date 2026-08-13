import { createRoot } from "react-dom/client";
import Home from "./page";
import "./globals.css";
import "./native.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("DictaTask could not find its application root.");
}

createRoot(root).render(<Home />);
