import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

const syncWindowActivity = () => {
  const inactive = document.hidden || !document.hasFocus();
  document.documentElement.classList.toggle("launcher-window-inactive", inactive);
};

syncWindowActivity();
window.addEventListener("focus", syncWindowActivity);
window.addEventListener("blur", syncWindowActivity);
document.addEventListener("visibilitychange", syncWindowActivity);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("focus", syncWindowActivity);
    window.removeEventListener("blur", syncWindowActivity);
    document.removeEventListener("visibilitychange", syncWindowActivity);
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
