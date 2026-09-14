// Benchmark wrapper: the original composition looped, with its own props, fps and size; props.frames sets the length.
import React from "react";
import { Composition, Loop } from "remotion";
import { staticFile } from "remotion";
import { CaptionedVideo, calculateCaptionedVideoMetadata } from "./CaptionedVideo";

const LOOP_TOTAL = 12800;
const STATIC_DURATION = 358;
const originalCalculateMetadata: any = calculateCaptionedVideoMetadata;
const Wrapped: React.FC<any> = ({ __loopFrames, ...props }) => (
  <Loop durationInFrames={__loopFrames}>
    <CaptionedVideo {...(props as any)} />
  </Loop>
);

export const BenchRoot: React.FC = () => (
  <Composition
    id="Bench"
    component={Wrapped}
    fps={30}
    width={1080}
    height={1920}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ ...({ src: staticFile("sample-video.mp4") } as any), __loopFrames: STATIC_DURATION }}
    calculateMetadata={async (args: any) => {
      const { __loopFrames, frames, ...original } = args.props;
      const meta = originalCalculateMetadata ? await originalCalculateMetadata({ ...args, props: original }) : {};
      const inner = meta.durationInFrames ?? STATIC_DURATION;
      return { ...meta, durationInFrames: frames ?? LOOP_TOTAL, props: { ...(meta.props ?? original), __loopFrames: inner } };
    }}
  />
);
