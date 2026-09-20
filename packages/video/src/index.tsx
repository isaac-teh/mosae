import React from "react";
import { Composition, registerRoot } from "remotion";
import { MosaeFilm } from "./Film";
import { birthdayStoryEdit, editDurationFrames } from "./edit";

const Root = () => <Composition
  id="MosaeFilm"
  component={MosaeFilm}
  durationInFrames={editDurationFrames(birthdayStoryEdit)}
  fps={birthdayStoryEdit.fps}
  width={birthdayStoryEdit.width}
  height={birthdayStoryEdit.height}
  defaultProps={{ edit: birthdayStoryEdit }}
/>;

registerRoot(Root);
