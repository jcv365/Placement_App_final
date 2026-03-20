"use client";

import HomeWorkflow from "@/components/home/HomeWorkflow";
import * as React from "react";

export default function HomeEntry() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <HomeWorkflow />;
}
