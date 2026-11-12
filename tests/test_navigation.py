import unittest
from html.parser import HTMLParser

from app.main import templates


class NavigationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.section = None
        self.links = {"header": [], "more": [], "footer": []}
        self.current_link = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div" and attrs.get("class") == "header-links":
            self.section = "header"
        elif tag == "nav" and attrs.get("class") == "header-more-menu":
            self.section = "more"
        elif tag == "footer":
            self.section = "footer"
        elif tag == "a" and self.section:
            attrs["label"] = ""
            self.links[self.section].append(attrs)
            self.current_link = attrs

    def handle_data(self, data):
        if self.current_link is not None:
            self.current_link["label"] += data

    def handle_endtag(self, tag):
        if tag == "a":
            self.current_link = None
        if (tag, self.section) in {
            ("div", "header"),
            ("nav", "more"),
            ("footer", "footer"),
        }:
            self.section = None


class NavigationTests(unittest.TestCase):
    def test_more_menu_contains_sorted_footer_and_menu_only_links(self):
        for enabled in (False, True):
            with self.subTest(alpha_time_trials_available=enabled):
                html = templates.env.get_template("base.html").render(
                    v="test", alpha_time_trials_available=enabled
                )
                parser = NavigationParser()
                parser.feed(html)
                header = {link["href"] for link in parser.links["header"]}
                footer = parser.links["footer"]
                more = [link["href"] for link in parser.links["more"]]
                feedback = next(link for link in footer if link["label"] == "Feedback & bugs")
                menu_only = [
                    {"href": "/active-racers", "label": "Active Racers"},
                    {"href": "/guide", "label": "Racing Guide"},
                    {"href": "/community", "label": "Community"},
                    {"href": "/challenges", "label": "Challenges"},
                    {"href": "/today", "label": "Race picker"},
                    {"href": "/thefts", "label": "Thefts"},
                    {"href": "/creators", "label": "Creators"},
                    {"href": "/cafe-saturday", "label": "Cafe Sat"},
                ]

                expected = sorted(
                    (
                        link
                        for link in footer + menu_only
                        if link["href"] not in {"/", feedback["href"]}
                        and link["href"] not in header
                    ),
                    key=lambda link: link["label"].casefold(),
                )
                self.assertEqual(more, [link["href"] for link in expected])
                self.assertNotIn(feedback["href"], more)
                self.assertTrue(
                    all(link["href"] not in {item["href"] for item in footer} for link in menu_only)
                )
                self.assertEqual("/alphas" in more, enabled)
                self.assertNotIn("/", more)
                self.assertIn("/challenges", more)
                self.assertIn("/creators", more)
                for url in ("/today", "/cafe-saturday", "/thefts"):
                    self.assertNotIn(url, header)
                    self.assertIn(url, more)
                self.assertEqual(feedback["target"], "_blank")
                self.assertEqual(feedback["rel"], "noopener")
