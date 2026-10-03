"use client";
import dynamic from "next/dynamic";
import { LoadingDots } from "@/components/LoadingDots";

// Same full-page three-dot loader every other page uses (components/ReadyGate.tsx's dots layer),
// shown while the Preview bundle itself loads.
function PageLoader() {
  return (
    <div className="center-lift" style={{ position: "fixed", inset: 0, zIndex: 9000, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <LoadingDots />
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
