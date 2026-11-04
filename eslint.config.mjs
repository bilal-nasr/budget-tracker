import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Physical-direction Tailwind utilities break RTL. Use logical ones instead:
// ms-/me-, ps-/pe-, start-/end-, text-start/text-end, rounded-s/e, border-s/e.
const PHYSICAL =
  "(?:^|[\\s:!])-?(?:(?:ml|mr|pl|pr|left|right)-(?:\\d|\\[|px|auto|full)|text-(?:left|right)(?![\\w-])|rounded-[lr](?:-|(?![\\w-]))|border-[lr](?:-|(?![\\w-])))";

const message =
  "Physical direction utility. Use logical utilities (ms-/me-, ps-/pe-, start-/end-, text-start/text-end, rounded-s/e, border-s/e) so RTL works.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${PHYSICAL}/]`, message },
        { selector: `TemplateElement[value.raw=/${PHYSICAL}/]`, message },
      ],
    },
  },
  globalIgnores([".next/**", ".impeccable/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
