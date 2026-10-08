export type Vec3 = [number, number, number]

/** Camera-follow step: target goes to the robot (x/y exact, z low-passed by `zDamp`), camera moves by the same delta so the view offset is preserved. */
export function followStep(target: Vec3, camera: Vec3, robot: Vec3, zDamp: number): { target: Vec3; camera: Vec3 } {
  const d: Vec3 = [robot[0] - target[0], robot[1] - target[1], (robot[2] - target[2]) * zDamp]
  return {
    target: [target[0] + d[0], target[1] + d[1], target[2] + d[2]],
    camera: [camera[0] + d[0], camera[1] + d[1], camera[2] + d[2]],
  }
}
