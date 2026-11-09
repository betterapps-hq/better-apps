import type { AppCommentsTypes, CommentsClient } from "@better-apps/comments/client"
import type { AppReactionsTypes } from "@better-apps/reactions/client"
import type { app } from "./better-apps.server"

/** The app's type. Browser code imports it as a type only, so no server code reaches the bundle. */
export type App = typeof app

/** The app's comment types: its subject types and anchor kinds. */
export type CommentTypes = AppCommentsTypes<App>

/** The comments store, typed for the app. */
export type Comments = CommentsClient<CommentTypes>

/** The app's reaction types: the subject types reactions are on, and the emoji it allows. */
export type ReactionTypes = AppReactionsTypes<App>
