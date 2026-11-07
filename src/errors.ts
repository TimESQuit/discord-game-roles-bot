/** An error whose message is safe to show to the member as is. */
export class UserFacingError extends Error {
  override name = "UserFacingError";
}
