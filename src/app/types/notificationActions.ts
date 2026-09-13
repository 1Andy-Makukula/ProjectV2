// What a notification can offer you, and where each path goes.
//
// A reminder used to be a sentence you had to act on from memory: "Mercy's
// graduation is in 9 days" and then go and find her yourself. Notifications now
// carry an ordered list of actions, each naming its own type, and this file is
// the single place that turns one into a destination.
//
// The database guarantees the shape -- every action has a `type` and a `label`,
// and there are never more than three -- but it deliberately does NOT constrain
// the set of types, so a surface can ship an action before this file knows
// about it. That means the resolver here must treat an unknown type as
// something to ignore rather than something to crash on, which is why
// `actionHref` returns null instead of throwing.

export interface NotificationAction {
  type: string;
  label: string;
  [param: string]: unknown;
}

/** Reads the actions column, tolerating the null and the malformed alike. */
export function parseActions(raw: unknown): NotificationAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is NotificationAction =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as NotificationAction).type === 'string' &&
      typeof (a as NotificationAction).label === 'string',
  );
}

const str = (action: NotificationAction, key: string): string | null => {
  const value = action[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * Where an action goes, or null if this build does not know the type.
 *
 * Null is a real answer, not a failure: a notification written by a newer
 * server than the client reading it should render its other actions and quietly
 * drop the one it cannot follow.
 */
export function actionHref(action: NotificationAction): string | null {
  switch (action.type) {
    case 'open_item': {
      const id = str(action, 'item_id');
      return id ? `/item/${id}` : null;
    }
    case 'open_shop': {
      const id = str(action, 'shop_id');
      return id ? `/shop/${id}` : null;
    }
    case 'open_contact': {
      const id = str(action, 'contact_id');
      return id ? `/contacts?contact=${id}` : null;
    }
    case 'open_group': {
      const id = str(action, 'group_id');
      return id ? `/contacts?group=${id}` : null;
    }
    case 'open_list': {
      const id = str(action, 'list_id');
      return id ? `/list/${id}` : null;
    }
    case 'open_goal': {
      const id = str(action, 'goal_id');
      return id ? `/dashboard?goal=${id}` : null;
    }
    case 'browse_for_occasion': {
      // The storefront's gifting face, told what it is shopping for. Both
      // parameters are optional on the server side, so both are optional here.
      const params = new URLSearchParams({ mode: 'gifting' });
      const kind = str(action, 'occasion_kind');
      const contact = str(action, 'contact_id');
      const group = str(action, 'group_id');
      if (kind) params.set('occasion', kind);
      if (contact) params.set('for', contact);
      if (group) params.set('group', group);
      return `/?${params.toString()}`;
    }
    default:
      return null;
  }
}

/**
 * Actions that do something in place rather than navigate.
 *
 * Kept separate from `actionHref` so a caller can tell a link from a button
 * without inspecting the type itself.
 */
export function isInlineAction(action: NotificationAction): boolean {
  return action.type === 'stop_watching';
}

/** Only the actions this build can actually carry out. */
export function usableActions(actions: NotificationAction[]): NotificationAction[] {
  return actions.filter((a) => isInlineAction(a) || actionHref(a) !== null);
}
