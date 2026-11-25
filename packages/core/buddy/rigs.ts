import type { Animal } from '../src/animals';

/**
 * The moving parts of each picture: ears and tails, each a line from its base `b` (where it joins
 * the body; that point never moves) to its tip `t`, in the image's own pixels. Parts that are hidden
 * or curled up (a tail tucked under a sleeping pet) have no entry. Fox and bunny scenes are the ones
 * the user approved in the live preview (art/warp-prototype.js); the rest were annotated by drawing
 * these lines over each image and checking the screenshots (sdd screens/rig-*.png).
 */

export type PartKind = 'ear' | 'tail';
export type Point = readonly [number, number];
export interface RigPart { readonly k: PartKind; readonly b: Point; readonly t: Point }

/** The three scenes each pet has, besides its standing pose. */
export type Scene = 'study' | 'break' | 'sleep';
export const SCENES: readonly Scene[] = ['study', 'break', 'sleep'];
/** A picture: one of the scenes, or `stand` (the standing pose, art/{animal}.png). */
export type Picture = Scene | 'stand';
/** `fox-study`, or `fox` for the standing pose. */
export type PictureKey = Animal | `${Animal}-${Scene}`;

export const pictureKey = (animal: Animal, picture: Picture): PictureKey =>
  picture === 'stand' ? animal : `${animal}-${picture}`;

/** Path of a picture under art/. */
export const pictureFile = (animal: Animal, picture: Picture): string =>
  picture === 'stand' ? `${animal}.png` : `scenes/${animal}-${picture}.png`;

/** Natural size [width, height] of every picture (checked against the PNGs by the tests). */
export const PICTURE_SIZE: Readonly<Record<PictureKey, readonly [number, number]>> = {
  cat: [327, 345], 'cat-study': [414, 287], 'cat-break': [442, 294], 'cat-sleep': [416, 215],
  fox: [296, 352], 'fox-study': [471, 311], 'fox-break': [476, 312], 'fox-sleep': [557, 271],
  panda: [326, 299], 'panda-study': [432, 294], 'panda-break': [416, 279], 'panda-sleep': [501, 258],
  bunny: [321, 321], 'bunny-study': [451, 301], 'bunny-break': [386, 287], 'bunny-sleep': [571, 255],
  dog: [345, 308], 'dog-study': [519, 294], 'dog-break': [581, 218], 'dog-sleep': [573, 229],
  hamster: [283, 274], 'hamster-study': [587, 273], 'hamster-break': [512, 257], 'hamster-sleep': [514, 234],
};

const ear = (b: Point, t: Point): RigPart => ({ k: 'ear', b, t });
const tail = (b: Point, t: Point): RigPart => ({ k: 'tail', b, t });

/** Every picture's rig (an empty list: nothing moves but the whole picture). */
export const RIGS: Readonly<Record<PictureKey, readonly RigPart[]>> = {
  // ---- Cat (wizard): ears poke out from under the hat; the sleeping cat's tail is curled round it.
  cat: [ear([130, 77], [122, 55]), ear([242, 92], [257, 72]), tail([272, 305], [315, 265])],
  'cat-study': [ear([178, 52], [170, 28]), ear([282, 65], [300, 44]), tail([347, 205], [397, 155])],
  'cat-break': [ear([147, 77], [132, 52]), ear([235, 45], [247, 27]), tail([120, 207], [72, 160])],
  'cat-sleep': [ear([88, 92], [68, 78]), ear([178, 30], [183, 10])],

  // ---- Fox (fire): scenes as approved in the preview.
  fox: [ear([87, 87], [62, 45]), ear([187, 87], [205, 47]), tail([207, 275], [246, 182])],
  'fox-study': [ear([215, 75], [190, 18]), ear([300, 70], [330, 12]), tail([360, 210], [405, 95])],
  'fox-break': [ear([180, 75], [155, 15]), ear([255, 65], [280, 5]), tail([160, 245], [70, 125])],
  'fox-sleep': [ear([156, 111], [124, 71]), ear([220, 87], [232, 27])],

  // ---- Panda (bamboo ranger): small round ears; the tail never shows.
  panda: [ear([87, 35], [70, 11]), ear([190, 35], [200, 10])],
  'panda-study': [ear([202, 35], [190, 11]), ear([285, 35], [297, 10])],
  'panda-break': [ear([157, 40], [142, 16]), ear([245, 30], [255, 6])],
  'panda-sleep': [ear([320, 20], [320, 2]), ear([382, 62], [400, 62])],

  // ---- Bunny (hooded cloak): the hood's long ears; scenes as approved in the preview.
  bunny: [ear([137, 62], [145, 12]), ear([215, 57], [220, 7])],
  'bunny-study': [ear([245, 78], [235, 10]), ear([295, 78], [305, 10])],
  'bunny-break': [ear([210, 70], [214, 10]), ear([270, 70], [282, 18])],
  'bunny-sleep': [ear([232, 61], [164, 53]), ear([180, 101], [112, 117])],

  // ---- Dog (knight): ears above the helmet; the sleeping dog's tail is curled round it.
  dog: [ear([145, 42], [132, 15]), ear([252, 30], [265, 5])],
  'dog-study': [ear([215, 32], [202, 5]), ear([325, 30], [337, 2]), tail([382, 192], [405, 135])],
  'dog-break': [ear([182, 35], [172, 8]), ear([140, 92], [110, 82]), tail([455, 100], [460, 25])],
  'dog-sleep': [ear([265, 40], [252, 8]), ear([185, 85], [162, 68])],

  // ---- Hamster (alchemist): round ears; no tail to speak of.
  hamster: [ear([77, 42], [54, 27]), ear([162, 25], [177, 10])],
  'hamster-study': [ear([200, 37], [185, 10]), ear([280, 27], [292, 7])],
  'hamster-break': [ear([207, 45], [187, 25]), ear([290, 22], [302, 6])],
  'hamster-sleep': [ear([300, 47], [287, 27]), ear([365, 77], [377, 70])],
};
