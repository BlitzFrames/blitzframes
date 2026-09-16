// Benchmark wrapper: the original composition with its own fps and size; props.frames sets the length.
// The flight is timed by the composition's length, so the whole route plays at every length instead of its first frames.
import React from "react";
import { Composition, Loop } from "remotion";
import { MyComposition } from "./Composition";

const LOOP_TOTAL = 12800;
const STATIC_DURATION = 50 * 30;
const Wrapped: React.FC<any> = ({ __loopFrames }) => (
  <Loop durationInFrames={__loopFrames}>
    <MyComposition />
  </Loop>
);

export const BenchRoot: React.FC = () => (
  <Composition
    id="Bench"
    component={Wrapped}
    fps={30}
    width={1280}
    height={720}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ __loopFrames: STATIC_DURATION } as any}
    calculateMetadata={async (args: any) => {
      const { frames } = args.props;
      return { durationInFrames: frames ?? LOOP_TOTAL, props: { __loopFrames: frames ?? STATIC_DURATION } };
    }}
  />
);
