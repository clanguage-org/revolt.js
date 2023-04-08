import { Accessor, Setter, createSignal } from "solid-js";

import { API, Metadata } from "revolt-api";
import type { DataLogin, RevoltConfig } from "revolt-api";

import { User } from "./classes";
import {
  ChannelCollection,
  EmojiCollection,
  MessageCollection,
  ServerCollection,
  ServerMemberCollection,
  UserCollection,
} from "./collections";
import { EventClient, createEventClient } from "./events/client";

export type Session = { token: string; user_id: string } | string;

/**
 * Revolt.js Client
 */
export class Client {
  readonly channels;
  readonly emojis;
  readonly messages;
  readonly users;
  readonly servers;
  readonly serverMembers;

  readonly api: API;
  readonly baseURL: string;
  readonly events: EventClient<1>;

  configuration: RevoltConfig | undefined;
  session: Session | undefined;
  user: User | undefined;

  readonly ready: Accessor<boolean>;
  #setReady: Setter<boolean>;

  /**
   * Create Revolt.js Client
   */
  constructor(baseURL?: string) {
    this.baseURL = baseURL ?? "https://api.revolt.chat";
    this.api = new API({
      baseURL,
    });

    this.events = createEventClient(1);

    const [ready, setReady] = createSignal(false);
    this.ready = ready;
    this.#setReady = setReady;

    this.channels = new ChannelCollection(this);
    this.emojis = new EmojiCollection(this);
    this.messages = new MessageCollection(this);
    this.users = new UserCollection(this);
    this.servers = new ServerCollection(this);
    this.serverMembers = new ServerMemberCollection(this);
  }

  /**
   * Connect
   */
  connect() {
    this.events.on("event", (event) => {
      console.info("[EVENT]", JSON.stringify(event).substring(0, 32));
      if (event.type === "Ready") {
        console.time("load users");
        for (const user of event.users) {
          const u = this.users.getOrCreate(user._id, user);

          if (u.relationship === "User") {
            this.user = u;
          }
        }
        console.timeEnd("load users");
        console.time("load servers");
        for (const server of event.servers) {
          this.servers.getOrCreate(server._id, server);
        }
        console.timeEnd("load servers");
        console.time("load memberships");
        for (const member of event.members) {
          this.serverMembers.getOrCreate(member._id, member);
        }
        console.timeEnd("load memberships");
        console.time("load channels");
        for (const channel of event.channels) {
          this.channels.getOrCreate(channel._id, channel);
        }
        console.timeEnd("load channels");
        console.time("load emojis");
        for (const emoji of event.emojis) {
          this.emojis.getOrCreate(emoji._id, emoji);
        }
        console.timeEnd("load emojis");

        const lounge = this.servers.get("01F7ZSBSFHQ8TA81725KQCSDDP")!;
        console.info(
          `The owner of ${lounge.name} is ${lounge.owner!.username}!`
        );
        console.log(lounge.owner);
        console.log(
          "It has the channels:",
          lounge.channels.map((channel) => channel.name)
        );
        /*console.log(
          "They joined at:",
          this.serverMembers.get({ server: lounge.id, user: lounge.owner!.id })
            ?.joinedAt
        );*/

        this.#setReady(true);
      }
    });

    this.events.on("state", (state) => console.info("STATE =", state));
    this.events.on("error", (error) => console.error("ERROR =", error));

    this.events.connect(
      "wss://ws.revolt.chat",
      typeof this.session === "string" ? this.session : this.session!.token
    );
  }

  /**
   * Fetches the configuration of the server if it has not been already fetched.
   */
  async #fetchConfiguration() {
    if (!this.configuration) {
      this.configuration = await this.api.get("/");
    }
  }

  /**
   * Update API object to use authentication.
   */
  #updateHeaders() {
    (this.api as API) = new API({
      baseURL: this.baseURL,
      authentication: {
        revolt: this.session,
      },
    });
  }

  /**
   * Log in with auth data, creating a new session in the process.
   * @param details Login data object
   * @returns An on-boarding function if on-boarding is required, undefined otherwise
   */
  async login(details: DataLogin) {
    await this.#fetchConfiguration();
    const data = await this.api.post("/auth/session/login", details);
    if (data.result === "Success") {
      this.session = data;
      // TODO: return await this.connect();
    } else {
      throw "MFA not implemented!";
    }
  }

  /**
   * Use an existing session to log into Revolt.
   * @param session Session data object
   * @returns An on-boarding function if on-boarding is required, undefined otherwise
   */
  async useExistingSession(session: Session) {
    await this.#fetchConfiguration();
    this.session = session;
    this.#updateHeaders();
    this.connect();
  }

  /**
   * Log in as a bot.
   * @param token Bot token
   */
  async loginBot(token: string) {
    await this.#fetchConfiguration();
    this.session = token;
    this.#updateHeaders();
    this.connect();
  }

  /**
   * Generates a URL to a given file with given options.
   * @param attachment Partial of attachment object
   * @param options Optional query parameters to modify object
   * @param allowAnimation Returns GIF if applicable, no operations occur on image
   * @param fallback Fallback URL
   * @returns Generated URL or nothing
   */
  generateFileURL(
    attachment?: {
      tag: string;
      _id: string;
      content_type?: string;
      metadata?: Metadata;
    },
    ...args: FileArgs
  ) {
    const [options, allowAnimation, fallback] = args;

    const autumn = this.configuration?.features.autumn;
    if (!autumn?.enabled) return fallback;
    if (!attachment) return fallback;

    const { tag, _id, content_type, metadata } = attachment;

    // TODO: server-side
    if (metadata?.type === "Image") {
      if (
        Math.min(metadata.width, metadata.height) <= 0 ||
        (content_type === "image/gif" &&
          Math.max(metadata.width, metadata.height) >= 4096)
      )
        return fallback;
    }

    let query = "";
    if (options) {
      if (!allowAnimation || content_type !== "image/gif") {
        query =
          "?" +
          Object.keys(options)
            .map((k) => `${k}=${options[k as keyof FileArgs[0]]}`)
            .join("&");
      }
    }

    return `${autumn.url}/${tag}/${_id}${query}`;
  }

  /**
   * Proxy a file through January.
   * @param url URL to proxy
   * @returns Proxied media URL
   */
  proxyFile(url: string): string | undefined {
    if (this.configuration?.features.january.enabled) {
      return `${
        this.configuration.features.january.url
      }/proxy?url=${encodeURIComponent(url)}`;
    }
  }
}

export type FileArgs = [
  options?: {
    max_side?: number;
    size?: number;
    width?: number;
    height?: number;
  },
  allowAnimation?: boolean,
  fallback?: string
];
