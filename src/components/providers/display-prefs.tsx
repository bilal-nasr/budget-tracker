"use client";

import { createContext, useContext } from "react";
import type { Digits } from "@/lib/money";

const DisplayPrefs = createContext<{ digits: Digits }>({ digits: "latin" });

export function DisplayPrefsProvider({
  digits,
  children,
}: {
  digits: Digits;
  children: React.ReactNode;
}) {
  return <DisplayPrefs value={{ digits }}>{children}</DisplayPrefs>;
}

export const useDisplayPrefs = () => useContext(DisplayPrefs);
