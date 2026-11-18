import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/press-start-2p/400.css";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/600.css";
import "./styles/app.css";
import { App } from "./App";
import { loadPersisted, startPersistence, useApp } from "./state/store";
import { setPackLookup } from "./core/packAccess";

setPackLookup((id) => useApp.getState().packs.find((p) => p.id === id));

// Block the browser's default "open dropped file" navigation everywhere.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

loadPersisted()
  .catch((e) => {
    console.error(e);
    useApp.setState({ ready: true });
  })
  .finally(() => {
    startPersistence();
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
