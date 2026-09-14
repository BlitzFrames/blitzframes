// Benchmark wrapper: the original composition looped, with its own props, fps and size; props.frames sets the length.
import React from "react";
import { Composition, Loop } from "remotion";
import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import { staticFile } from "remotion";
import { Visualizer } from "./Visualizer/Main";

const LOOP_TOTAL = 12800;
const STATIC_DURATION = 7165;
const originalCalculateMetadata: any = (async ({ props }: any) => { const input = new Input({ source: new UrlSource(props.audioFileUrl), formats: ALL_FORMATS }); const durationInSeconds = await input.computeDuration(); return { durationInFrames: Math.floor((durationInSeconds - props.audioOffsetInSeconds) * 30), fps: 30 }; });
const Wrapped: React.FC<any> = ({ __loopFrames, ...props }) => (
  <Loop durationInFrames={__loopFrames}>
    <Visualizer {...(props as any)} />
  </Loop>
);

export const BenchRoot: React.FC = () => (
  <Composition
    id="Bench"
    component={Wrapped}
    fps={30}
    width={1080}
    height={1080}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ ...({
          // audio settings
          audioOffsetInSeconds: 0,
          audioFileUrl: staticFile("demo-track.mp3"),
          // song data
          coverImageUrl: staticFile("demo-song-cover.jpeg"),
          songName: "Sunset Render Deja Vu",
          artistName: "Remotion",
          textColor: "white",
          // visualizer settings
          visualizer: {
            type: "spectrum" as const,
            bassOverlay: true,
            color: "#0b84f3",
            linesToDisplay: 65,
            mirrorWave: false,
            numberOfSamples: "512" as const,
          },
        } as any), __loopFrames: STATIC_DURATION }}
    calculateMetadata={async (args: any) => {
      const { __loopFrames, frames, ...original } = args.props;
      const meta = originalCalculateMetadata ? await originalCalculateMetadata({ ...args, props: original }) : {};
      const inner = meta.durationInFrames ?? STATIC_DURATION;
      return { ...meta, durationInFrames: frames ?? LOOP_TOTAL, props: { ...(meta.props ?? original), __loopFrames: inner } };
    }}
  />
);
