/**
 * Ask the navbar's Login button to start the Hypha auth flow.
 *
 * The real flow lives in `LoginButton` (it stores the redirect path, opens the
 * provider window and reconnects the store afterwards), and there is no way to
 * call it from elsewhere. Anything that needs to offer "log in" therefore had
 * only two options: tell the user to go and find the button themselves, or
 * duplicate the flow. A one-line event avoids both.
 *
 * `LoginButton` is mounted with the navbar on every route except the annotate
 * page, so a dispatch is a no-op there rather than an error.
 */
export const REQUEST_LOGIN_EVENT = 'bioimageio:request-login';

export const requestLogin = (): void => {
  window.dispatchEvent(new Event(REQUEST_LOGIN_EVENT));
};
