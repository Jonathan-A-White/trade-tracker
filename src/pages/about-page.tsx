import { PageHeader } from "@/components/layout/page-header";
import { CREDIT_GROUPS, NEWTON_QUOTE } from "@/content/credits";

const linkClass = "text-blue-600 dark:text-blue-400 underline";

export default function AboutPage() {
  return (
    <div>
      <PageHeader title="About" backTo="/settings" />
      <div className="p-4 space-y-6">
        <figure className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 space-y-3">
          <blockquote className="text-base italic text-gray-900 dark:text-gray-100">
            “{NEWTON_QUOTE.text}”
          </blockquote>
          <figcaption className="text-sm text-gray-500 dark:text-gray-400">
            {NEWTON_QUOTE.attribution}
          </figcaption>
          <p className="text-sm text-gray-700 dark:text-gray-300">{NEWTON_QUOTE.why}</p>
        </figure>

        {CREDIT_GROUPS.map((group) => (
          <section key={group.title} className="space-y-2">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">{group.title}</h2>
            <ul className="space-y-2">
              {group.credits.map((c) => (
                <li
                  key={c.name}
                  className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-3 space-y-1 text-sm"
                >
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className={`${linkClass} font-medium`}>
                    {c.name}
                  </a>
                  <p className="text-gray-700 dark:text-gray-300">{c.use}</p>
                  <p className="text-gray-500 dark:text-gray-400">
                    Licence:{" "}
                    <a href={c.licenceUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                      {c.licence}
                    </a>
                  </p>
                  <p className="text-gray-500 dark:text-gray-400">Changes: {c.changes}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
