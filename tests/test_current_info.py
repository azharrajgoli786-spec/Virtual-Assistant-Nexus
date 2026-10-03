import io
import json
import unittest
import base64
from types import SimpleNamespace
from unittest.mock import patch

import app as nexus


class CurrentInformationTests(unittest.TestCase):
    def test_freshness_detection_limits_external_search(self):
        self.assertTrue(nexus.needs_live_information("What are today's headlines?"))
        self.assertTrue(nexus.needs_live_information("Who is the current president?"))
        self.assertFalse(nexus.needs_live_information("Write a short poem about the sea."))

    def test_search_parser_extracts_result_title_snippet_and_link(self):
        target = base64.urlsafe_b64encode(b"https://example.com/news").decode("ascii").rstrip("=")
        html = (
            '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1'
            + target
            + '">Example headline</a></h2><div class="b_caption">'
            '<p class="b_lineclamp2">A current report summary.</p>'
            '</div></li>'
        )
        with patch.object(
            nexus.urllib.request,
            "urlopen",
            side_effect=lambda *args, **kwargs: io.BytesIO(html.encode("utf-8")),
        ):
            results = nexus.search_current_web("latest news")

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "Example headline")
        self.assertEqual(results[0]["snippet"], "A current report summary.")
        self.assertEqual(results[0]["url"], "https://example.com/news")

    def test_model_receives_live_sources_and_answer_lists_links(self):
        sources = [{
            "title": "Today's report",
            "url": "https://example.com/today",
            "snippet": "A verified current development.",
        }]
        response = unittest.mock.Mock()
        response.status_code = 200
        response.json.return_value = {
            "choices": [{"message": {"content": "Here is the current update. [Source 1]"}}]
        }
        original_key = nexus.app.config.get("GROQ_API_KEY")
        nexus.app.config["GROQ_API_KEY"] = "test-key"
        try:
            mocked_requests = SimpleNamespace(post=unittest.mock.Mock(return_value=response))
            with patch.object(nexus, "search_current_web", return_value=sources), patch.object(
                nexus, "requests", mocked_requests
            ):
                answer = nexus.generate_chat_response("What is the latest update?")
        finally:
            nexus.app.config["GROQ_API_KEY"] = original_key

        payload = json.loads(mocked_requests.post.call_args.kwargs["data"].decode("utf-8"))
        self.assertIn("A verified current development.", payload["messages"][1]["content"])
        self.assertIn("retrieved_at", payload["messages"][1]["content"])
        self.assertIn("https://example.com/today", answer)

    def test_current_query_disclaims_when_search_has_no_results(self):
        original_key = nexus.app.config.get("GROQ_API_KEY")
        nexus.app.config["GROQ_API_KEY"] = None
        try:
            with patch.object(nexus, "search_current_web", return_value=[]):
                answer = nexus.generate_chat_response("What is today's news?")
        finally:
            nexus.app.config["GROQ_API_KEY"] = original_key

        self.assertIn("can't verify the latest information", answer.lower())


if __name__ == "__main__":
    unittest.main()