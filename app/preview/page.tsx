"use client";
import dynamic from "next/dynamic";

const SPIN_CSS = `@keyframes _spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;

function PageLoader() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "Arial, sans-serif" }}>
      <style suppressHydrationWarning>{SPIN_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 120 }}>
        <div style={{ width: 17, height: 17, border: "2px solid #eee", borderTopColor: "#555",
          borderRadius: "50%", animation: "_spin 0.8s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: 15, letterSpacing: "0.08em", color: "#666" }}>Loading...</span>
      </div>
    </div>
  );
}

const PreviewClient = dynamic(() => import("./PreviewClient"), {
  ssr: false,
  loading: () => <PageLoader />,
});

export default function Page() {
  return <PreviewClient />;
}
