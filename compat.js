import Clutter from 'gi://Clutter';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const SHELL_VERSION = Number.parseInt(Config.PACKAGE_VERSION.split('.')[0], 10);

/**
 * Constructor props for a vertical or horizontal St.BoxLayout.
 *
 * GNOME 51 removed St.BoxLayout:vertical in favour of :orientation
 * (gnome-shell !3614). Keep `vertical` on 46–50 so those shells still
 * construct.
 *
 * @param {boolean} [vertical=true]
 * @returns {object}
 */
export function boxLayoutOrientation(vertical = true) {
    if (SHELL_VERSION >= 51) {
        return {
            orientation: vertical
                ? Clutter.Orientation.VERTICAL
                : Clutter.Orientation.HORIZONTAL,
        };
    }
    return { vertical };
}
