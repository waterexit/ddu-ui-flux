import {
    ActionFlags,
    type BaseParams,
    type Context,
    type DduItem,
    type DduOptions,
    UiActionArguments,
    type UiOptions,
} from "jsr:@shougo/ddu-vim@~10.0.0/types";
import { BaseUi, type UiActions } from "jsr:@shougo/ddu-vim@~10.0.0/ui";

import type { Denops } from "jsr:@denops/std@~7.4.0";
import * as fn from "jsr:@denops/std@~7.4.0/function";

import {
    nvim__redraw,
    nvim_create_namespace,
    nvim_set_hl,
    nvim_win_close,
    nvim_win_get_cursor,
    nvim_win_get_width,
    nvim_win_set_cursor,
    nvim_win_set_hl_ns,
} from "jsr:@denops/std@~7.4.0/function/nvim";

type FloatingBorder =
    | "none"
    | "single"
    | "double"
    | "rounded"
    | "solid"
    | "shadow"
    | string[];

type FloatingOpts = {
    relative: "editor" | "win" | "cursor" | "mouse";
    row: number;
    col: number;
    width: number;
    height: number;
    border?: FloatingBorder;
    title?: string;
    title_pos?: "left" | "center" | "right";
};

type Params = {
    debug: boolean;
    border: FloatingBorder;
    row: number | string;
    col: number | string;
    width: number | string;
    scrollSpeedMs: number;
    displayIntervalMin: number | undefined;
    bg: string;
    fg: string;
};

export class Ui extends BaseUi<Params> {
    NAME_SPACE = "hl-ui-flux-group";
    #bufferName = "ddu-ui-flux";
    #popupId: number = -1;
    #items: DduItem[] = [];
    #nameSpaceId: unknown;
    #index: number = 0;
    #prevIndex: number = -1;
    #scrollTimeoutId: number = -1;
    #nextNewsIntervalId: number = -1;

    override async onInit(args: {
        denops: Denops;
        uiParams: Params;
    }): Promise<void> {
        if (args.uiParams.debug) {
            console.log("[debug] on_init");
        }
        this.#nameSpaceId = await nvim_create_namespace(
            args.denops,
            this.NAME_SPACE,
        );
        await nvim_set_hl(args.denops, this.#nameSpaceId, "NormalFloat", {
            bg: "none",
            fg: args.uiParams.fg,
        });
    }

    override async refreshItems(args: {
        denops: Denops;
        context: Context;
        uiParams: Params;
        items: DduItem[];
    }): Promise<void> {
        if (args.uiParams.debug) {
            console.log("[debug] reflesh Items");
        }

        this.#items = args.items;
        this.#index = 0;
        return;
    }

    override async redraw(args: {
        denops: Denops;
        context: Context;
        options: DduOptions;
        uiOptions: UiOptions;
        uiParams: Params;
    }): Promise<void> {
        if (args.uiParams.debug) {
            console.log("[debug] redraw");
        }
        if (args.options.sync && !args.context.done) {
            return;
        }

        const initialized = await fn.bufexists(args.denops, this.#bufferName) &&
            await fn.bufnr(args.denops, this.#bufferName);
        const bufnr = initialized ||
            await initBuffer(args.denops, this.#bufferName, args.options.name);

        const hasNvim = args.denops.meta.host === "nvim";
        if (hasNvim) {
            const winOpts: FloatingOpts = await parseOpts(
                args.denops,
                args.uiParams,
            );
            if (this.#popupId === -1) {
                this.#popupId = await args.denops.call(
                    "nvim_open_win",
                    bufnr,
                    false,
                    winOpts,
                ) as number;
                await fn.setbufvar(args.denops, bufnr, "&number", false);
                await fn.setbufvar(args.denops, bufnr, "&wrap", false);
                await fn.setbufvar(args.denops, bufnr, "&sidescrolloff", 1);
                nvim_win_set_hl_ns(
                    args.denops,
                    this.#popupId,
                    this.#nameSpaceId,
                );
            }
            if (this.#items.length != 0 && this.#index !== this.#prevIndex) {
                await this.writeBuf(
                    args.denops,
                    this.#items[this.#index],
                    args.uiParams,
                    winOpts,
                );
                this.#prevIndex = this.#index;
            }
        }
        if (args.uiParams.displayIntervalMin) {
            this.setAnounceNextNews(
                args.denops,
                args.uiParams.displayIntervalMin,
                args.options.name,
            );
        }
    }

    setAnounceNextNews(
        denops: Denops,
        displayIntervalMin: number,
        name: string,
    ) {
        clearTimeout(this.#nextNewsIntervalId);
        this.#nextNewsIntervalId = setTimeout(
            () => denops.call("ddu#ui#do_action", "next", {}, name),
            displayIntervalMin * 60 * 1000,
        );
    }

    async writeBuf(
        denops: Denops,
        item: DduItem,
        uiParam: Params,
        winParam: FloatingOpts,
    ) {
        await this.fadeOut(denops, uiParam);
        await fn.setbufvar(denops, this.#bufferName, "&modifiable", true);
        if (item) {
            const word = " ".repeat(winParam.width) + item.word +
                " ".repeat(winParam.width);
            await fn.setbufline(
                denops,
                this.#bufferName,
                1,
                word,
            );
            await nvim_win_set_cursor(denops, this.#popupId, [
                1,
                winParam.width,
            ]);
            this.fadeIn(denops, uiParam);
            await this.setScroll(denops, word, uiParam.scrollSpeedMs);
        }
        await fn.setbufvar(denops, this.#bufferName, "&modifiable", false);
    }

    async fadeOut(denops: Denops, uiParam: Params) {
        for (
            let percentage = 5;
            percentage <= 100;
            percentage = percentage + 5
        ) {
            const changedColor = adjustLightness(
                uiParam.fg,
                uiParam.bg,
                percentage,
            );
            await nvim_set_hl(denops, this.#nameSpaceId, "NormalFloat", {
                bg: "none",
                fg: changedColor,
            });
            await nvim__redraw(denops, { win: this.#popupId, valid: false });
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    async fadeIn(denops: Denops, uiParam: Params) {
        for (
            let percentage = 5;
            percentage <= 100;
            percentage = percentage + 5
        ) {
            const changedColor = adjustLightness(
                uiParam.bg,
                uiParam.fg,
                percentage,
            );
            await nvim_set_hl(denops, this.#nameSpaceId, "NormalFloat", {
                bg: "none",
                fg: changedColor,
            });
            await nvim__redraw(denops, { win: this.#popupId, valid: false });
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }

    override actions: UiActions<Params> = {
        quit: async (args: {
            denops: Denops;
            context: Context;
            options: DduOptions;
            uiParams: Params;
            actionParams: BaseParams;
        }) => {
            await this.quit(args);
            return ActionFlags.None;
        },
        next: () => {
            if (this.#index !== this.#items.length - 1) {
                this.#index++;
            }
            return ActionFlags.Redraw;
        },
        prev: () => {
            if (this.#index !== 0) {
                this.#index--;
            }
            return ActionFlags.Redraw;
        },
        itemAction: async (args: {
            denops: Denops;
            options: DduOptions;
            uiParams: Params;
            actionParams: BaseParams;
        }) => {
            await args.denops.call(
                "ddu#item_action",
                args.options.name,
                "default",
                [this.#items[this.#index]],
                {},
            );

            return ActionFlags.None;
        },
    };

    override params(): Params {
        return {
            debug: false,
            border: "none",
            row: 0,
            col: "&columns-10",
            width: 20,
            scrollSpeedMs: 500,
            displayIntervalMin: 1,
            bg: "#000000",
            fg: "#ffffff",
        };
    }

    override async quit(args: {
        denops: Denops;
        context: Context;
        options: DduOptions;
        uiParams: Params;
    }): Promise<void> {
        if (args.uiParams.debug) {
            console.log("[debug] quit");
        }
        clearTimeout(this.#scrollTimeoutId);
        clearTimeout(this.#nextNewsIntervalId);
        await nvim_win_close(args.denops, this.#popupId, true);
        this.#popupId = -1;
    }

    async setScroll(
        denops: Denops,
        word: string,
        interval: number,
    ) {
        const colByte =
            (await nvim_win_get_cursor(denops, this.#popupId) as number[])[
                1
            ];
        const initalIndex = await fn.charidx(denops, word, colByte);
        let index = initalIndex;
        const scroll = async () => {
            const currentWord = await fn.getbufline(
                denops,
                this.#bufferName,
                1,
            );
            if (word !== currentWord[0]) {
                return;
            }
            if (index < word.length) {
                const nextIndex = await fn.byteidx(denops, word, index);
                await nvim_win_set_cursor(denops, this.#popupId, [
                    1,
                    nextIndex,
                ]);
                index++;
            } else {
                index = initalIndex;
                await fn.win_execute(
                    denops,
                    this.#popupId,
                    "normal! 9999zh",
                );
            }
            this.#scrollTimeoutId = setTimeout(
                async () => await scroll(),
                interval,
            );
        };
        this.#scrollTimeoutId = setTimeout(
            async () => await scroll(),
            interval,
        );
    }
}

async function initBuffer(
    denops: Denops,
    bufferName: string,
    name: string,
): Promise<number> {
    const bufnr = await fn.bufadd(denops, bufferName);
    await fn.bufload(denops, bufnr);
    await fn.setbufvar(denops, bufnr, "&filetype", "ddu-flux");
    // We need set ddu_ui_name. because ddu#ui#do_action('') needs this buf var
    await fn.setbufvar(denops, bufnr, "ddu_ui_name", name);
    await fn.setbufvar(denops, bufnr, "&modifiable", true);
    await fn.setbufvar(denops, bufnr, "&buftype", "nofile");
    return bufnr;
}

// TODO adapt cterm
function adjustLightness(
    color: string,
    goal: string = "#ffffff",
    percentage: number,
) {
    let r = parseInt(color.slice(1, 3), 16);
    let g = parseInt(color.slice(3, 5), 16);
    let b = parseInt(color.slice(5, 7), 16);

    const rg = parseInt(goal.slice(1, 3), 16);
    const gg = parseInt(goal.slice(3, 5), 16);
    const bg = parseInt(goal.slice(5, 7), 16);

    function adjust(x: number, y: number) {
        return Math.floor(Math.max(0, x + (y - x) * percentage / 100));
    }

    r = adjust(r, rg);
    g = adjust(g, gg);
    b = adjust(b, bg);
    return `#${r.toString(16).padStart(2, "0")}${
        g.toString(16).padStart(2, "0")
    }${b.toString(16).padStart(2, "0")}`;
}

async function parseOpts(
    denops: Denops,
    uiParams: Params,
): Promise<FloatingOpts> {
    const evalVim = async (value: number | string) => {
        if (typeof value === "string") {
            const expression = await denops.eval(value);
            return parseInt(expression as string);
        } else {
            return value;
        }
    };

    return {
        "relative": "editor",
        "row": await evalVim(uiParams.row),
        "col": await evalVim(uiParams.col),
        "width": await evalVim(uiParams.width),
        "height": 1,
        "border": uiParams.border,
    };
}
