// Benchmark wrapper: the original composition looped, with its own props, fps and size; props.frames sets the length.
import React from "react";
import { Composition, Loop } from "remotion";
import { Main, mainCalculateMetadataScene } from "./Main";
import { VIDEO_FPS, VIDEO_WIDTH, VIDEO_HEIGHT } from "../types/constants";

const LOOP_TOTAL = 12800;
const LOOP_PERIOD = 200; // frame N is frame N mod 200: the scenes after frame 200 fail on a 2048 MB stock Lambda or in the template itself
const STATIC_DURATION = 1800;
const originalCalculateMetadata: any = mainCalculateMetadataScene;
const Wrapped: React.FC<any> = ({ __loopFrames, ...props }) => (
  <Loop durationInFrames={__loopFrames}>
    <Main {...(props as any)} />
  </Loop>
);

export const BenchRoot: React.FC = () => (
  <Composition
    id="Bench"
    component={Wrapped}
    fps={VIDEO_FPS}
    width={VIDEO_WIDTH}
    height={VIDEO_HEIGHT}
    durationInFrames={LOOP_TOTAL}
    defaultProps={{ ...({
          login: "JonnyBurger",
          corner: "bottom-left",
          topLanguages: {
            language1: {
              type: "designed",
              name: "TypeScript",
              percent: 0.6348066751851184,
            },
            language2: {
              type: "other",
              color: "#fcb32c",
              name: "MDX",
              percent: 0.3204561738200702,
            },
            language3: {
              type: "designed",
              name: "JavaScript",
              percent: 0.03752374246343604,
            },
          },
          showHelperLine: false,
          planet: "Gold",
          starsGiven: 9,
          issuesClosed: 195,
          issuesOpened: 39,
          totalPullRequests: 873,
          topWeekday: "4",
          totalContributions: 9489,
          topHour: "10",
          graphData: [
            {
              productivity: 0,
              time: 0,
            },
            {
              productivity: 0,
              time: 1,
            },
            {
              productivity: 0,
              time: 2,
            },
            {
              productivity: 0,
              time: 3,
            },
            {
              productivity: 0,
              time: 4,
            },
            {
              productivity: 0,
              time: 5,
            },
            {
              productivity: 0,
              time: 6,
            },
            {
              productivity: 4,
              time: 7,
            },
            {
              productivity: 13,
              time: 8,
            },
            {
              productivity: 20,
              time: 9,
            },
            {
              productivity: 42,
              time: 10,
            },
            {
              productivity: 38,
              time: 11,
            },
            {
              productivity: 20,
              time: 12,
            },
            {
              productivity: 14,
              time: 13,
            },
            {
              productivity: 36,
              time: 14,
            },
            {
              productivity: 32,
              time: 15,
            },
            {
              productivity: 32,
              time: 16,
            },
            {
              productivity: 18,
              time: 17,
            },
            {
              productivity: 20,
              time: 18,
            },
            {
              productivity: 7,
              time: 19,
            },
            {
              productivity: 4,
              time: 20,
            },
            {
              productivity: 0,
              time: 21,
            },
            {
              productivity: 0,
              time: 22,
            },
            {
              productivity: 0,
              time: 23,
            },
          ],
          openingSceneStartAngle: "right",
          rocket: "yellow",
          contributionData: [
            3, 0, 0, 0, 6, 53, 48, 52, 36, 33, 5, 28, 17, 0, 53, 30, 37, 40, 37,
            40, 65, 27, 74, 36, 46, 37, 0, 12, 39, 34, 58, 30, 11, 0, 50, 49,
            36, 27, 36, 6, 18, 6, 39, 15, 27, 54, 32, 19, 52, 52, 10, 54, 38,
            22, 0, 0, 30, 34, 22, 18, 25, 1, 0, 0, 33, 29, 18, 41, 11, 7, 44,
            37, 12, 15, 8, 9, 2, 35, 37, 12, 26, 89, 15, 22, 9, 98, 47, 23, 7,
            22, 11, 19, 30, 48, 35, 60, 1, 27, 36, 28, 49, 45, 121, 0, 42, 116,
            101, 50, 56, 35, 48, 50, 70, 62, 31, 34, 43, 93, 27, 17, 39, 18, 70,
            33, 28, 37, 24, 37, 77, 23, 54, 40, 4, 6, 16, 13, 16, 25, 64, 16,
            17, 17, 64, 29, 27, 9, 38, 29, 71, 129, 38, 89, 0, 10, 36, 32, 26,
            37, 49, 13, 0, 14, 49, 24, 21, 27, 7, 13, 36, 28, 24, 36, 31, 8, 28,
            51, 56, 10, 0, 0, 0, 0, 7, 2, 0, 5, 4, 0, 2, 10, 32, 27, 0, 0, 0, 0,
            17, 25, 32, 11, 9, 3, 33, 45, 23, 47, 28, 38, 19, 15, 19, 27, 17, 6,
            45, 25, 6, 47, 35, 25, 24, 29, 7, 10, 32, 32, 29, 43, 22, 3, 8, 18,
            55, 12, 18, 8, 0, 20, 21, 31, 18, 10, 2, 30, 23, 47, 39, 30, 33, 50,
            31, 0, 22, 18, 22, 0, 6, 0, 0, 13, 13, 9, 6, 3, 0, 0, 14, 0, 8, 47,
            267, 21, 8, 15, 23, 50, 52, 63, 0, 0, 22, 39, 32, 26, 50, 29, 10,
            85, 25, 3, 13, 6, 0, 0, 5, 2, 38, 5, 2, 5, 1, 7, 34, 33, 23, 37, 58,
            16, 30, 22, 45, 59, 40, 0, 21, 24, 24, 22, 12, 15, 3, 0, 8, 66, 14,
            48, 33, 6, 12, 25, 18, 10, 16, 40, 33, 1, 50, 33, 28, 36, 42, 9, 0,
            47, 10, 32, 45, 31, 4, 32, 8, 10, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0,
          ],
          sampleStarredRepos: [
            {
              name: "remotion-templates",
              author: "reactvideoeditor",
            },
            {
              name: "react-scan",
              author: "aidenybai",
            },
            {
              name: "mp4-muxer",
              author: "Vanilagy",
            },
            {
              name: "core",
              author: "diffusionstudio",
            },
            {
              name: "ladybird",
              author: "LadybirdBrowser",
            },
            {
              name: "remotion-bar-race-chart",
              author: "hylarucoder",
            },
            {
              name: "mp4-h264-re-encode",
              author: "vjeux",
            },
            {
              name: "seamless-aac-split-and-stitch-demo",
              author: "wistia",
            },
            {
              name: "analyzer-public",
              author: "vtclab",
            },
          ],
          longestStreak: 48,
        } as any), __loopFrames: Math.min(STATIC_DURATION, LOOP_PERIOD) }}
    calculateMetadata={async (args: any) => {
      const { __loopFrames, frames, ...original } = args.props;
      const meta = originalCalculateMetadata ? await originalCalculateMetadata({ ...args, props: original }) : {};
      const inner = Math.min(meta.durationInFrames ?? STATIC_DURATION, LOOP_PERIOD);
      return { ...meta, durationInFrames: frames ?? LOOP_TOTAL, props: { ...(meta.props ?? original), __loopFrames: inner } };
    }}
  />
);
