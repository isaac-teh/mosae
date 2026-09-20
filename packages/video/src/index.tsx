import React from "react";
import { Composition, registerRoot, staticFile } from "remotion";
import { MosaeFilm } from "./Film";
import { MosaeTimeline } from "./Timeline";
import { birthdayStoryEdit, editDurationFrames } from "./edit";
import { fixtureSources, fixtureTimeline } from "./fixtureTimeline";
import { timelineMetadata } from "./timelineMetadata";

const resolved = Object.fromEntries(Object.entries(fixtureSources).map(([key, path]) => [key, staticFile(path)]));

const Root = () => (
  <>
    <Composition
      id="MosaeTimeline"
      component={MosaeTimeline}
      defaultProps={{ timeline: fixtureTimeline, sources: resolved }}
      calculateMetadata={timelineMetadata}
      durationInFrames={180}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="MosaeFilm"
      component={MosaeFilm}
      durationInFrames={editDurationFrames(birthdayStoryEdit)}
      fps={birthdayStoryEdit.fps}
      width={birthdayStoryEdit.width}
      height={birthdayStoryEdit.height}
      defaultProps={{ edit: birthdayStoryEdit }}
    />
  </>
);

registerRoot(Root);
