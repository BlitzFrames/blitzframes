// Benchmark wrapper: the original composition looped, with its own props, fps and size; props.frames sets the length.
import React from "react";
import { Composition, Loop } from "remotion";
import { Main } from "./Main";
import { calculateMetadata } from "./calculate-metadata/calculate-metadata";

const LOOP_TOTAL = 12800;
const STATIC_DURATION = 360;
const originalCalculateMetadata: any = calculateMetadata;
const Wrapped: React.FC<any> = ({ __loopFrames, ...props }) => (
  <Loop durationInFrames={__loopFrames}>
    <Main {...(props as any)} />
  </Loop>
);

export const BenchRoot: React.FC = () => (
  <Composition
    id="Bench"
    component={Wrapped}
    fps={30}
    width={1106}
    height={1080}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ ...({ steps: null, themeColors: null, theme: "github-dark" as const, codeWidth: null, width: { type: "auto" as const } } as any), __loopFrames: STATIC_DURATION }}
    calculateMetadata={async (args: any) => {
      const { __loopFrames, frames, ...original } = args.props;
      const meta = originalCalculateMetadata ? await originalCalculateMetadata({ ...args, props: original }) : {};
      const inner = meta.durationInFrames ?? STATIC_DURATION;
      return { ...meta, durationInFrames: frames ?? LOOP_TOTAL, props: { ...(meta.props ?? original), __loopFrames: inner } };
    }}
  />
);
