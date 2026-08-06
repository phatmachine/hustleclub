#!/usr/bin/env python3
"""
HustleClub App Stress Test
==========================

Criteria:
- Concurrent Users: Uses ThreadPoolExecutor to simulate 20 users making requests simultaneously
- Realistic Queries: Randomly selects from a list of sample queries to mimic user behavior
- Token Tracking: Logs input/output tokens per query and totals per user
- Delay Simulation: Adds a 1-second delay between queries to avoid overwhelming the app
- Error Handling: Logs failed requests or errors

Usage:
    python3 stress_test.py
    
To test with different parameters:
    python3 stress_test.py --users 20 --queries 10 --delay 1.0
"""

import requests
import json
import random
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import argparse
import sys
from collections import defaultdict

# Configuration
DEFAULT_API_URL = "http://localhost:3001/api/chat"
DEFAULT_USERS = 20
DEFAULT_QUERIES_PER_USER = 10
DEFAULT_DELAY = 1.0  # seconds between queries per user

# Sample queries that mimic real user behavior
SAMPLE_QUERIES = [
    "I want to start a business, what should I do first?",
    "How do I validate my business idea?",
    "What's a good business for a teenager to start?",
    "How much money do I need to start a small business?",
    "What are some low-cost business ideas?",
    "How do I create a business plan?",
    "What should I sell to make money?",
    "How do I find customers for my business?",
    "What are the best marketing strategies for a small business?",
    "How do I price my products or services?",
    "I have an idea for a lemonade stand, is it good?",
    "What are the legal requirements for starting a business?",
    "How do I manage my time as a student entrepreneur?",
    "What skills do I need to be a successful entrepreneur?",
    "How do I handle competition in my business?",
    "What's the best way to test my business idea before launching?",
    "How do I create a brand for my business?",
    "What are some common mistakes new entrepreneurs make?",
    "How do I stay motivated when starting a business?",
    "What tools or resources do I need to start my business?"
]

class StressTest:
    def __init__(self, api_url, num_users, queries_per_user, delay, output_file=None):
        self.api_url = api_url.rstrip('/')
        self.num_users = num_users
        self.queries_per_user = queries_per_user
        self.delay = delay
        self.output_file = output_file
        
        # Statistics
        self.total_tokens = {'input': 0, 'output': 0}
        self.user_tokens = defaultdict(lambda: {'input': 0, 'output': 0, 'queries': 0, 'errors': 0})
        self.errors = []
        self.success_count = 0
        self.error_count = 0
        self.start_time = None
        self.end_time = None
        
        # Lock for thread-safe operations
        self.lock = threading.Lock()
    
    def make_request(self, user_id, query_text):
        """Make a single API request and return the results"""
        headers = {'Content-Type': 'application/json'}
        payload = {
            'purpose': 'chat',
            'messages': [{'role': 'user', 'content': query_text}]
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                f"{self.api_url}/api/chat",
                headers=headers,
                json=payload,
                timeout=30
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                input_tokens = data.get('usage', {}).get('input', 0)
                output_tokens = data.get('usage', {}).get('output', 0)
                
                return {
                    'user_id': user_id,
                    'query': query_text,
                    'success': True,
                    'status_code': response.status_code,
                    'input_tokens': input_tokens,
                    'output_tokens': output_tokens,
                    'response_time': response_time,
                    'model': data.get('model', 'unknown'),
                    'provider': data.get('provider', 'unknown')
                }
            else:
                return {
                    'user_id': user_id,
                    'query': query_text,
                    'success': False,
                    'status_code': response.status_code,
                    'error': f"HTTP {response.status_code}: {response.text[:200]}",
                    'response_time': response_time
                }
                
        except Exception as e:
            return {
                'user_id': user_id,
                'query': query_text,
                'success': False,
                'error': str(e),
                'response_time': 0
            }
    
    def user_session(self, user_id):
        """Simulate a user session with multiple queries"""
        user_results = []
        
        for i in range(self.queries_per_user):
            # Add delay between queries
            if i > 0:
                time.sleep(self.delay)
            
            # Select a random query
            query = random.choice(SAMPLE_QUERIES)
            
            # Make the request
            result = self.make_request(user_id, query)
            user_results.append(result)
            
            # Update statistics
            with self.lock:
                if result['success']:
                    self.success_count += 1
                    self.total_tokens['input'] += result.get('input_tokens', 0)
                    self.total_tokens['output'] += result.get('output_tokens', 0)
                    self.user_tokens[user_id]['input'] += result.get('input_tokens', 0)
                    self.user_tokens[user_id]['output'] += result.get('output_tokens', 0)
                    self.user_tokens[user_id]['queries'] += 1
                else:
                    self.error_count += 1
                    self.user_tokens[user_id]['errors'] += 1
                    self.errors.append(result)
        
        return user_results
    
    def run_test(self):
        """Run the stress test with concurrent users"""
        print(f"\n{'='*60}")
        print(f"HUSTLECLUB APP STRESS TEST")
        print(f"{'='*60}")
        print(f"API URL: {self.api_url}")
        print(f"Concurrent Users: {self.num_users}")
        print(f"Queries per User: {self.queries_per_user}")
        print(f"Delay between queries: {self.delay}s")
        print(f"Total Requests: {self.num_users * self.queries_per_user}")
        print(f"{'='*60}\n")
        
        self.start_time = datetime.now()
        
        # Run concurrent user sessions
        with ThreadPoolExecutor(max_workers=self.num_users) as executor:
            futures = {}
            for user_id in range(1, self.num_users + 1):
                future = executor.submit(self.user_session, user_id)
                futures[future] = user_id
            
            # Wait for all users to complete
            for future in as_completed(futures):
                user_id = futures[future]
                try:
                    results = future.result()
                except Exception as e:
                    with self.lock:
                        self.error_count += self.queries_per_user
                        self.user_tokens[user_id]['errors'] += self.queries_per_user
                        self.errors.append({'user_id': user_id, 'error': str(e)})
        
        self.end_time = datetime.now()
        
        # Generate report
        self.generate_report()
    
    def generate_report(self):
        """Generate a comprehensive test report"""
        duration = (self.end_time - self.start_time).total_seconds()
        total_requests = self.num_users * self.queries_per_user
        
        print(f"\n{'='*60}")
        print("STRESS TEST RESULTS")
        print(f"{'='*60}")
        print(f"Test Duration: {duration:.2f} seconds")
        print(f"Total Requests: {total_requests}")
        print(f"Successful Requests: {self.success_count}")
        print(f"Failed Requests: {self.error_count}")
        print(f"Success Rate: {(self.success_count / total_requests * 100):.1f}%")
        print(f"{'='*60}")
        
        # Token Usage Summary
        print(f"\nTOKEN USAGE SUMMARY:")
        print(f"Total Input Tokens: {self.total_tokens['input']:,}")
        print(f"Total Output Tokens: {self.total_tokens['output']:,}")
        print(f"Total Tokens: {self.total_tokens['input'] + self.total_tokens['output']:,}")
        print(f"Average Tokens per Request: {(self.total_tokens['input'] + self.total_tokens['output']) / self.success_count if self.success_count > 0 else 0:.1f}")
        
        # Per-User Analysis
        print(f"\nPER-USER ANALYSIS:")
        print(f"{'User':<6} {'Queries':<8} {'Input':<10} {'Output':<10} {'Errors':<8} {'Total':<10}")
        print(f"{'-'*6} {'-'*8} {'-'*10} {'-'*10} {'-'*8} {'-'*10}")
        
        for user_id in sorted(self.user_tokens.keys()):
            tokens = self.user_tokens[user_id]
            total = tokens['input'] + tokens['output']
            print(f"{user_id:<6} {tokens['queries']:<8} {tokens['input']:<10,} {tokens['output']:<10,} {tokens['errors']:<8} {total:<10,}")
        
        # Cost Analysis (Mistral pricing: ~$0.25 per 1M input tokens, ~$0.25 per 1M output tokens)
        input_cost = (self.total_tokens['input'] / 1_000_000) * 0.25
        output_cost = (self.total_tokens['output'] / 1_000_000) * 0.25
        total_cost = input_cost + output_cost
        
        print(f"\nCOST ANALYSIS (Mistral Pricing):")
        print(f"Estimated Input Cost: ${input_cost:.4f}")
        print(f"Estimated Output Cost: ${output_cost:.4f}")
        print(f"Total Estimated Cost: ${total_cost:.4f}")
        print(f"Cost per User: ${total_cost / self.num_users if self.num_users > 0 else 0:.4f}")
        print(f"Cost per Request: ${total_cost / self.success_count if self.success_count > 0 else 0:.6f}")
        
        # Error Analysis
        if self.errors:
            print(f"\nERROR ANALYSIS:")
            print(f"Total Errors: {len(self.errors)}")
            error_types = defaultdict(int)
            for error in self.errors:
                error_type = error.get('error', 'Unknown')[:50]
                error_types[error_type] += 1
            for error_type, count in sorted(error_types.items(), key=lambda x: x[1], reverse=True):
                print(f"  {error_type}: {count} occurrences")
        
        # Performance Metrics
        if self.success_count > 0:
            avg_response_time = sum(
                result['response_time'] for result in self.user_tokens.values() 
                if isinstance(result, dict) and 'response_time' in result
            ) / self.success_count
            print(f"\nPERFORMANCE METRICS:")
            print(f"Average Response Time: {avg_response_time:.3f}s")
            print(f"Requests per Second: {self.success_count / duration if duration > 0 else 0:.2f}")
        
        # Save to file if specified
        if self.output_file:
            self.save_report_to_file()
        
        print(f"\n{'='*60}")
        print("STRESS TEST COMPLETE")
        print(f"{'='*60}\n")
    
    def save_report_to_file(self):
        """Save the report to a file"""
        duration = (self.end_time - self.start_time).total_seconds()
        total_requests = self.num_users * self.queries_per_user
        
        with open(self.output_file, 'w') as f:
            f.write(f"HUSTLECLUB APP STRESS TEST REPORT\n")
            f.write(f"Generated: {datetime.now().isoformat()}\n")
            f.write(f"API URL: {self.api_url}\n")
            f.write(f"Concurrent Users: {self.num_users}\n")
            f.write(f"Queries per User: {self.queries_per_user}\n")
            f.write(f"Delay: {self.delay}s\n")
            f.write(f"Total Requests: {total_requests}\n\n")
            
            f.write(f"RESULTS:\n")
            f.write(f"Duration: {duration:.2f} seconds\n")
            f.write(f"Successful: {self.success_count}\n")
            f.write(f"Failed: {self.error_count}\n")
            f.write(f"Success Rate: {(self.success_count / total_requests * 100):.1f}%\n\n")
            
            f.write(f"TOKEN USAGE:\n")
            f.write(f"Input Tokens: {self.total_tokens['input']:,}\n")
            f.write(f"Output Tokens: {self.total_tokens['output']:,}\n")
            f.write(f"Total Tokens: {self.total_tokens['input'] + self.total_tokens['output']:,}\n\n")
            
            f.write(f"COST ANALYSIS:\n")
            input_cost = (self.total_tokens['input'] / 1_000_000) * 0.25
            output_cost = (self.total_tokens['output'] / 1_000_000) * 0.25
            total_cost = input_cost + output_cost
            f.write(f"Total Estimated Cost: ${total_cost:.4f}\n")
            f.write(f"Cost per User: ${total_cost / self.num_users if self.num_users > 0 else 0:.4f}\n")
            f.write(f"Cost per Request: ${total_cost / self.success_count if self.success_count > 0 else 0:.6f}\n\n")
            
            f.write(f"PER-USER DETAILS:\n")
            f.write(f"{'User':<6} {'Queries':<8} {'Input':<10} {'Output':<10} {'Errors':<8} {'Total':<10}\n")
            f.write(f"{'-'*6} {'-'*8} {'-'*10} {'-'*10} {'-'*8} {'-'*10}\n")
            
            for user_id in sorted(self.user_tokens.keys()):
                tokens = self.user_tokens[user_id]
                total = tokens['input'] + tokens['output']
                f.write(f"{user_id:<6} {tokens['queries']:<8} {tokens['input']:<10,} {tokens['output']:<10,} {tokens['errors']:<8} {total:<10,}\n")
        
        print(f"Report saved to: {self.output_file}")

def main():
    parser = argparse.ArgumentParser(description='HustleClub App Stress Test')
    parser.add_argument('--api-url', default=DEFAULT_API_URL, help='API endpoint URL')
    parser.add_argument('--users', type=int, default=DEFAULT_USERS, help='Number of concurrent users')
    parser.add_argument('--queries', type=int, default=DEFAULT_QUERIES_PER_USER, help='Queries per user')
    parser.add_argument('--delay', type=float, default=DEFAULT_DELAY, help='Delay between queries in seconds')
    parser.add_argument('--output', help='Output file for detailed report')
    
    args = parser.parse_args()
    
    # Validate API is accessible
    try:
        response = requests.get(f"{args.api_url}", timeout=5)
        if response.status_code != 200:
            print(f"❌ API is not accessible: HTTP {response.status_code}")
            print(f"   URL: {args.api_url}")
            sys.exit(1)
    except Exception as e:
        print(f"❌ API connection failed: {e}")
        print(f"   URL: {args.api_url}")
        sys.exit(1)
    
    print(f"✅ API is accessible at {args.api_url}")
    
    # Run the stress test
    test = StressTest(
        api_url=args.api_url,
        num_users=args.users,
        queries_per_user=args.queries,
        delay=args.delay,
        output_file=args.output
    )
    
    test.run_test()

if __name__ == '__main__':
    main()