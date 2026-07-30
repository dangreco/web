// Two booleans, three states. The intended encoding, written out:
const NAMES: Record<string, string> = {
  "false,false": "STOPPED",
  "true,false": "PLAYING",
  "true,true": "PAUSED",
};

let isPlaying = false;
let isPaused = false;

const stateName = () => NAMES[`${isPlaying},${isPaused}`] ?? "not in S";

function play() {
  isPlaying = true;
  isPaused = false;
}

function pause() {
  // Nothing here asks whether there was anything to pause.
  isPaused = true;
}

function stop() {
  isPlaying = false;
  isPaused = false;
}

export default function main(): () => void {
  const step = (label: string, apply: () => void) => {
    apply();
    console.log(
      `${label.padEnd(5)} -> ${stateName().padEnd(9)}` +
        ` isPlaying=${isPlaying} isPaused=${isPaused}`,
    );
  };

  // The table says PAUSE while STOPPED is a no-op. It is the first line below.
  step("PAUSE", pause);
  step("PLAY", play);
  step("PAUSE", pause);
  step("STOP", stop);

  return () => {};
}
