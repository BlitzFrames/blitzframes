// Benchmark wrapper: the original composition looped, with its own props, fps and size; props.frames sets the length.
import React from "react";
import { Composition, Loop } from "remotion";
import { Main } from "./Main";
import { DEFAULT_SPEAKER } from "./speaker";

const LOOP_TOTAL = 12800;
const LOOP_PERIOD = 200; // frame N is frame N mod 200: the scenes after frame 200 fail on a 2048 MB stock Lambda or in the template itself
const STATIC_DURATION = 604;
const originalCalculateMetadata: any = null;
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
    width={1920}
    height={1080}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ ...(DEFAULT_SPEAKER as any), __loopFrames: Math.min(STATIC_DURATION, LOOP_PERIOD) }}
    calculateMetadata={async (args: any) => {
      const { __loopFrames, frames, ...original } = args.props;
      const meta = originalCalculateMetadata ? await originalCalculateMetadata({ ...args, props: original }) : {};
      const inner = Math.min(meta.durationInFrames ?? STATIC_DURATION, LOOP_PERIOD);
      return { ...meta, durationInFrames: frames ?? LOOP_TOTAL, props: { ...(meta.props ?? original), __loopFrames: inner } };
    }}
  />
);
