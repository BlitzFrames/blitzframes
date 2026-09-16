import { LoadSkia } from "@shopify/react-native-skia/src/web";
import { registerRoot } from "remotion";
(async () => { await LoadSkia(); const { BenchRoot } = await import("./BenchRoot"); registerRoot(BenchRoot); })();
