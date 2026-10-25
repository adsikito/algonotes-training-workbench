#include <iostream>
#include <vector>
#include <algorithm>
int main(){
 std::vector<int> v{3,1,4};std::make_heap(v.begin(),v.end());std::cout<<v.front()<<'\n';
 v.push_back(5);std::push_heap(v.begin(),v.end());std::cout<<v.front()<<'\n';
 std::pop_heap(v.begin(),v.end());std::cout<<v.back()<<'\n';v.pop_back();
 std::sort_heap(v.begin(),v.end());for(std::size_t i=0;i<v.size();++i)std::cout<<(i?" ":"")<<v[i];std::cout<<'\n';
 std::cout<<std::is_heap(v.begin(),v.end())<<'\n';
}
